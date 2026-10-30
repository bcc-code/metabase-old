import { useState } from "react";
import { t } from "ttag";

import {
  skipToken,
  useCreateCustomVizPluginMutation,
  useGetCustomVizPluginQuery,
  useReplaceCustomVizPluginBundleMutation,
} from "metabase/api";
import { getErrorMessage } from "metabase/api/utils";
import { Link } from "metabase/common/components/Link";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { useMetadataToasts } from "metabase/common/hooks";
import { useNavigate } from "metabase/router";
import {
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";
import {
  Alert,
  Button,
  FileInput,
  Group,
  Icon,
  Stack,
  Text,
} from "metabase/ui";
import * as Urls from "metabase/urls";
import type { CustomVizPlugin, CustomVizPluginId } from "metabase-types/api";

import { HOST_API_GLOBAL_NAME } from "../host";

import { TrustedCodeAlert } from "./TrustedCodeAlert";

const BUNDLE_FILE_TYPES = ".js,text/javascript,application/javascript";

type CustomVizPageProps = {
  params: { id?: string };
};

function parsePluginId(id: string | undefined): CustomVizPluginId | undefined {
  const pluginId = id ? parseInt(id, 10) : NaN;
  return Number.isSafeInteger(pluginId) ? pluginId : undefined;
}

/**
 * Installs a new custom visualization, or, with an `id` param, replaces the
 * bundle of an installed one.
 */
export function CustomVizPage({ params }: CustomVizPageProps) {
  const pluginId = parsePluginId(params.id);
  const isNew = params.id === undefined;
  const {
    data: plugin,
    isLoading,
    error,
  } = useGetCustomVizPluginQuery(pluginId ?? skipToken);

  const title = plugin
    ? t`Replace the bundle of ${plugin.display_name}`
    : t`Add a custom visualization`;

  return (
    <SettingsPageWrapper title={isNew || plugin ? title : undefined}>
      <Link to={Urls.customViz()} variant="brand">
        {t`Back to custom visualizations`}
      </Link>
      <LoadingAndErrorWrapper
        loading={isLoading}
        error={isNew || pluginId !== undefined ? error : t`Not found.`}
      >
        <BundleUploadForm plugin={plugin} />
      </LoadingAndErrorWrapper>
    </SettingsPageWrapper>
  );
}

type BundleUploadFormProps = {
  plugin: CustomVizPlugin | undefined;
};

function BundleUploadForm({ plugin }: BundleUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [createPlugin, { isLoading: isCreating }] =
    useCreateCustomVizPluginMutation();
  const [replaceBundle, { isLoading: isReplacing }] =
    useReplaceCustomVizPluginBundleMutation();
  const navigate = useNavigate();
  const { sendSuccessToast } = useMetadataToasts();

  const handleSubmit = async () => {
    if (!file) {
      return;
    }
    setUploadError(null);
    try {
      const installed = plugin
        ? await replaceBundle({ id: plugin.id, file }).unwrap()
        : await createPlugin({ file }).unwrap();
      sendSuccessToast(
        plugin
          ? t`Updated ${installed.display_name}`
          : t`Installed ${installed.display_name}`,
      );
      navigate(Urls.customViz());
    } catch (error) {
      setUploadError(
        getErrorMessage(error, t`The bundle couldn't be uploaded.`),
      );
    }
  };

  return (
    <SettingsSection>
      <TrustedCodeAlert />
      <Text>
        {plugin
          ? t`Upload the new version of the visualization's JavaScript bundle. It must declare the identifier "${plugin.identifier}", which questions use to refer to it.`
          : t`Upload the visualization's JavaScript bundle: a single file that starts with a metabase-custom-viz manifest comment and calls ${HOST_API_GLOBAL_NAME}.define.`}
      </Text>
      <Stack gap="md" maw="32rem">
        <FileInput
          label={t`Bundle`}
          placeholder={t`Choose a .js file`}
          accept={BUNDLE_FILE_TYPES}
          fileInputProps={{ "aria-label": t`Bundle file` }}
          value={file}
          onChange={setFile}
          clearable
        />
        {uploadError && (
          <Alert
            color="error"
            icon={<Icon name="warning" />}
            title={t`The bundle wasn't installed`}
          >
            {uploadError}
          </Alert>
        )}
        <Group gap="sm">
          <Button
            variant="filled"
            disabled={!file}
            loading={isCreating || isReplacing}
            onClick={handleSubmit}
          >
            {plugin ? t`Replace bundle` : t`Install`}
          </Button>
          <Button component={Link} to={Urls.customViz()}>
            {t`Cancel`}
          </Button>
        </Group>
      </Stack>
    </SettingsSection>
  );
}
