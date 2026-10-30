import { useDisclosure } from "@mantine/hooks";
import { useFormikContext } from "formik";
import { useState } from "react";
import { t } from "ttag";
import * as Yup from "yup";

import { getErrorMessage } from "metabase/api/utils/errors";
import { ConfirmModal } from "metabase/common/components/ConfirmModal";
import {
  Form,
  FormErrorMessage,
  FormNumberInput,
  FormProvider,
  FormRadioGroup,
  FormSubmitButton,
  FormSwitch,
  FormTextInput,
} from "metabase/forms";
import { useSelector } from "metabase/redux";
import { getApplicationName } from "metabase/selectors/whitelabel";
import { Alert, Button, Group, Icon, Radio, Stack, Text } from "metabase/ui";
import * as Errors from "metabase/utils/errors";
import type {
  GitSyncConnectionCheck,
  GitSyncSettings,
  GitSyncType,
  UpdateGitSyncSettingsRequest,
} from "metabase-types/api";

import {
  useDisconnectGitSyncMutation,
  useTestGitSyncConnectionMutation,
  useUpdateGitSyncSettingsMutation,
} from "../api";

const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 1440;
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/i;

export type RepositoryFormValues = {
  url: string;
  branch: string;
  /** Empty keeps the saved token. */
  token: string;
  type: GitSyncType;
  auto_import: boolean;
  auto_import_interval: number;
  author_name: string;
  author_email: string;
};

const getSchema = () =>
  Yup.object({
    url: Yup.string()
      .required(Errors.required)
      .matches(HTTP_URL_PATTERN, () => t`must be an HTTPS URL`),
    branch: Yup.string().required(Errors.required),
    token: Yup.string(),
    type: Yup.mixed<GitSyncType>().oneOf(["read-write", "read-only"]),
    auto_import: Yup.boolean(),
    auto_import_interval: Yup.number()
      .integer()
      .min(MIN_INTERVAL_MINUTES)
      .max(MAX_INTERVAL_MINUTES)
      .required(Errors.required),
    author_name: Yup.string(),
    author_email: Yup.string().email(Errors.email),
  });

const getInitialValues = (settings: GitSyncSettings): RepositoryFormValues => ({
  url: settings.url ?? "",
  branch: settings.branch,
  token: "",
  type: settings.type,
  auto_import: settings.auto_import,
  auto_import_interval: settings.auto_import_interval,
  author_name: settings.author_name ?? "",
  author_email: settings.author_email ?? "",
});

export const getUpdateRequest = (
  values: RepositoryFormValues,
): UpdateGitSyncSettingsRequest => ({
  url: values.url.trim(),
  branch: values.branch.trim(),
  token: values.token === "" ? undefined : values.token,
  type: values.type,
  auto_import: values.auto_import,
  auto_import_interval: values.auto_import_interval,
  author_name: values.author_name.trim() || null,
  author_email: values.author_email.trim() || null,
});

type RepositoryFormProps = {
  settings: GitSyncSettings;
};

/**
 * Connects the repository and sets how this instance syncs with it. Saving
 * checks that the repository can be reached first.
 */
export function RepositoryForm({ settings }: RepositoryFormProps) {
  const applicationName = useSelector(getApplicationName);
  const [updateSettings] = useUpdateGitSyncSettingsMutation();
  const [savedCheck, setSavedCheck] = useState<GitSyncConnectionCheck | null>(
    null,
  );

  const handleSubmit = async (values: RepositoryFormValues) => {
    setSavedCheck(null);
    const response = await updateSettings(getUpdateRequest(values)).unwrap();
    setSavedCheck(response);
  };

  return (
    <FormProvider
      initialValues={getInitialValues(settings)}
      validationSchema={getSchema()}
      enableReinitialize
      onSubmit={handleSubmit}
    >
      {({ dirty, values }) => (
        <Form>
          <Stack gap="lg">
            <FormTextInput
              name="url"
              label={t`Repository URL`}
              description={t`The HTTPS address of the repository, as you would clone it.`}
              placeholder="https://github.com/your-org/metabase-content.git"
            />
            <FormTextInput
              name="branch"
              label={t`Branch`}
              description={t`The branch to export to and import from. The first export creates it if it doesn't exist.`}
              placeholder="main"
            />
            <FormTextInput
              name="token"
              type="password"
              autoComplete="new-password"
              label={t`Access token`}
              description={t`A personal or project access token that can read the repository and, to export, push to it. Leave it empty for a public repository you only import from.`}
              placeholder={
                settings.token_set
                  ? t`Saved. Leave empty to keep it.`
                  : t`Paste a token`
              }
            />
            <FormRadioGroup name="type" label={t`This instance…`}>
              <Stack gap="sm" mt="xs">
                <Radio
                  value="read-write"
                  label={t`Edits synced content and exports it`}
                  description={t`For an instance where people build content to review and share through Git.`}
                />
                <Radio
                  value="read-only"
                  label={t`Only imports from Git`}
                  description={t`For a production instance: synced content can't be edited here, only updated from the branch.`}
                />
              </Stack>
            </FormRadioGroup>
            <FormSwitch
              name="auto_import"
              label={t`Import new commits on a schedule`}
            />
            {values.auto_import && (
              <FormNumberInput
                name="auto_import_interval"
                label={t`Check for new commits every (minutes)`}
                min={MIN_INTERVAL_MINUTES}
                max={MAX_INTERVAL_MINUTES}
                maw="16rem"
              />
            )}
            <Group grow align="flex-start">
              <FormTextInput
                name="author_name"
                label={t`Committer name`}
                placeholder={applicationName}
              />
              <FormTextInput
                name="author_email"
                label={t`Committer email`}
                placeholder="metabase@example.com"
              />
            </Group>
            {savedCheck && !dirty && (
              <ConnectionCheckResult
                check={savedCheck}
                branch={settings.branch}
              />
            )}
            <RepositoryFormActions settings={settings} isDirty={dirty} />
          </Stack>
        </Form>
      )}
    </FormProvider>
  );
}

function ConnectionCheckResult({
  check,
  branch,
}: {
  check: GitSyncConnectionCheck;
  branch: string;
}) {
  const branchList = check.branches.join(", ");
  return (
    <Alert color="success" icon={<Icon name="check" />}>
      <Stack gap="xs">
        <Text>
          {check.branches.length > 0
            ? t`Connected. Branches: ${branchList}.`
            : t`Connected. The repository is empty.`}
        </Text>
        {!check.branch_exists && (
          <Text>{t`The branch ${branch} doesn't exist yet. The first export creates it.`}</Text>
        )}
      </Stack>
    </Alert>
  );
}

function RepositoryFormActions({
  settings,
  isDirty,
}: {
  settings: GitSyncSettings;
  isDirty: boolean;
}) {
  const { values } = useFormikContext<RepositoryFormValues>();
  const [testConnection, testState] = useTestGitSyncConnectionMutation();
  const branch = values.branch.trim();
  const canTest = HTTP_URL_PATTERN.test(values.url.trim());

  const handleTest = () => {
    testState.reset();
    testConnection({
      url: values.url.trim(),
      branch: branch || undefined,
      token: values.token || undefined,
    });
  };

  return (
    <Stack gap="md">
      <Group gap="sm">
        <FormSubmitButton
          label={settings.enabled ? t`Save changes` : t`Connect`}
          variant="filled"
          disabled={settings.enabled && !isDirty}
        />
        <Button
          variant="default"
          loading={testState.isLoading}
          disabled={!canTest}
          onClick={handleTest}
        >
          {t`Test connection`}
        </Button>
        {settings.enabled && <DisconnectButton />}
      </Group>
      {testState.data && (
        <ConnectionCheckResult check={testState.data} branch={branch} />
      )}
      {testState.error != null && (
        <Alert color="error" icon={<Icon name="warning" />}>
          {getErrorMessage(testState.error)}
        </Alert>
      )}
      <FormErrorMessage />
    </Stack>
  );
}

function DisconnectButton() {
  const [isOpened, { open, close }] = useDisclosure(false);
  const [disconnect, { error }] = useDisconnectGitSyncMutation();

  return (
    <>
      <Button variant="subtle" color="negative" onClick={open}>
        {t`Disconnect`}
      </Button>
      <ConfirmModal
        opened={isOpened}
        title={t`Disconnect the repository?`}
        message={t`Exports and imports stop. Collections stay marked as synced, so connecting again picks up where you left off.`}
        confirmButtonText={t`Disconnect`}
        confirmButtonProps={{ color: "negative" }}
        errorMessage={error != null ? getErrorMessage(error) : undefined}
        onConfirm={async () => {
          const result = await disconnect();
          if (!result.error) {
            close();
          }
        }}
        onClose={close}
      />
    </>
  );
}
