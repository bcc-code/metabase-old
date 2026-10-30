import type { FormikHelpers } from "formik";
import { useFormikContext } from "formik";
import { useCallback, useMemo, useState } from "react";
import { t } from "ttag";
import * as Yup from "yup";

import { SettingsGroupMappingSection } from "metabase/admin/settings/auth/components/GroupMappings";
import {
  getDefaultPlaceholder,
  getExtraFormFieldProps,
  getStoredFieldValue,
} from "metabase/admin/settings/utils";
import { getErrorMessage } from "metabase/api/utils/errors";
import { CopyTextInput } from "metabase/common/components/CopyTextInput";
import { LeaveRouteConfirmModal } from "metabase/common/components/LeaveConfirmModal";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import {
  Form,
  FormErrorMessage,
  FormProvider,
  FormSubmitButton,
  FormSwitch,
  FormTextInput,
  FormTextarea,
} from "metabase/forms";
import { useSelector } from "metabase/redux";
import { getApplicationName } from "metabase/selectors/whitelabel";
import {
  useGetAdminSettingsDetailsQuery,
  useGetSettingsQuery,
} from "metabase/settings";
import {
  CollapsibleSettingsSection,
  SETTINGS_CARD_STACK_PROPS,
  SETTINGS_CARD_TITLE_PROPS,
  SettingsPageWrapper,
  SettingsSection,
} from "metabase/settings-components";
import { Alert, Box, Button, Flex, Icon, Stack, Text } from "metabase/ui";
import * as Errors from "metabase/utils/errors";
import type {
  EnterpriseSettings,
  OidcConnectionCheck,
  OidcSsoSettings,
  SettingDefinitionMap,
} from "metabase-types/api";

import {
  useCheckOidcConnectionMutation,
  useGetOidcSsoInfoQuery,
  useUpdateOidcSsoSettingsMutation,
} from "../../api";
import { isHttpUrl } from "../../utils";

const OIDC_TEXT_KEYS = [
  "oidc-issuer-uri",
  "oidc-client-id",
  "oidc-client-secret",
  "oidc-login-prompt",
  "oidc-scopes",
  "oidc-authorization-params",
  "oidc-allowed-email-domains",
  "oidc-attribute-email",
  "oidc-attribute-firstname",
  "oidc-attribute-lastname",
  "oidc-attribute-groups",
  "oidc-user-attributes",
] as const satisfies (keyof OidcSsoSettings)[];

type OidcTextKey = (typeof OIDC_TEXT_KEYS)[number];

export type OidcFormValues = Record<OidcTextKey, string | null> & {
  "oidc-user-provisioning-enabled?": boolean;
};

const getOidcSchema = () =>
  Yup.object({
    "oidc-issuer-uri": Yup.string()
      .nullable()
      .required(Errors.required)
      .test(
        "http-url",
        () => t`Enter a URL that starts with https:// or http://`,
        (value) => value == null || isHttpUrl(value),
      ),
    "oidc-client-id": Yup.string().nullable().required(Errors.required),
    "oidc-client-secret": Yup.string().nullable().required(Errors.required),
  });

export const getOidcFormValues = (
  settingDetails: SettingDefinitionMap,
  settingValues: EnterpriseSettings,
): OidcFormValues => {
  const storedValue = (key: OidcTextKey) =>
    getStoredFieldValue(settingDetails[key], settingValues[key]);

  return {
    "oidc-issuer-uri": storedValue("oidc-issuer-uri"),
    "oidc-client-id": storedValue("oidc-client-id"),
    "oidc-client-secret": storedValue("oidc-client-secret"),
    "oidc-login-prompt": storedValue("oidc-login-prompt"),
    "oidc-scopes": storedValue("oidc-scopes"),
    "oidc-authorization-params": storedValue("oidc-authorization-params"),
    "oidc-allowed-email-domains": storedValue("oidc-allowed-email-domains"),
    "oidc-attribute-email": storedValue("oidc-attribute-email"),
    "oidc-attribute-firstname": storedValue("oidc-attribute-firstname"),
    "oidc-attribute-lastname": storedValue("oidc-attribute-lastname"),
    "oidc-attribute-groups": storedValue("oidc-attribute-groups"),
    "oidc-user-attributes": storedValue("oidc-user-attributes"),
    "oidc-user-provisioning-enabled?":
      settingValues["oidc-user-provisioning-enabled?"] ?? true,
  };
};

/** The OpenID Connect settings page, at Admin > Settings > Authentication > OIDC. */
export function SettingsOIDCForm() {
  const {
    data: settingDetails,
    isLoading: isLoadingDetails,
    error: detailsError,
  } = useGetAdminSettingsDetailsQuery();
  const {
    data: settingValues,
    isLoading: isLoadingValues,
    error: valuesError,
  } = useGetSettingsQuery();
  const { data: info, isLoading: isLoadingInfo } = useGetOidcSsoInfoQuery();
  const [updateOidcSettings] = useUpdateOidcSsoSettingsMutation();
  const applicationName = useSelector(getApplicationName);
  const schema = useMemo(getOidcSchema, []);

  const isEnabled = Boolean(settingValues?.["oidc-enabled"]);
  const isConfigured = Boolean(settingValues?.["oidc-configured"]);

  const handleSubmit = useCallback(
    async (values: OidcFormValues, helpers: FormikHelpers<OidcFormValues>) => {
      await updateOidcSettings({ ...values, "oidc-enabled": true }).unwrap();
      helpers.resetForm({ values });
    },
    [updateOidcSettings],
  );

  if (isLoadingDetails || isLoadingValues || isLoadingInfo) {
    return <LoadingAndErrorWrapper loading />;
  }

  if (!settingDetails || !settingValues || detailsError || valuesError) {
    return (
      <LoadingAndErrorWrapper
        error={t`Error loading the OpenID Connect settings`}
      />
    );
  }

  return (
    <SettingsPageWrapper
      title={t`OpenID Connect`}
      description={t`Let people sign in to ${applicationName} with an OpenID Connect identity provider. Register ${applicationName} as a web application at your provider, then enter the details it gives you.`}
    >
      {info && !info["encryption-enabled"] && (
        <Alert color="warning" icon={<Icon name="warning" />}>
          {t`OpenID Connect sign-in needs the MB_ENCRYPTION_SECRET_KEY environment variable, which protects each sign-in attempt. Set it and restart ${applicationName} before you turn sign-in on.`}
        </Alert>
      )}
      <FormProvider
        initialValues={getOidcFormValues(settingDetails, settingValues)}
        validationSchema={schema}
        onSubmit={handleSubmit}
      >
        {({ dirty, isSubmitting }) => (
          <Form>
            <Stack gap="xl">
              <SettingsSection
                title={t`Identity provider`}
                titleProps={SETTINGS_CARD_TITLE_PROPS}
                stackProps={SETTINGS_CARD_STACK_PROPS}
              >
                <Stack gap="lg">
                  <RedirectUri redirectUri={info?.["redirect-uri"] ?? null} />
                  <FormTextInput
                    name="oidc-issuer-uri"
                    label={t`Issuer URI`}
                    placeholder="https://login.example.com/"
                    required
                    autoFocus
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-issuer-uri"],
                    )}
                  />
                  <FormTextInput
                    name="oidc-client-id"
                    label={t`Client ID`}
                    required
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-client-id"],
                    )}
                  />
                  <FormTextInput
                    name="oidc-client-secret"
                    label={t`Client secret`}
                    type="password"
                    autoComplete="off"
                    required
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-client-secret"],
                    )}
                  />
                  <ConnectionCheck />
                </Stack>
              </SettingsSection>
              <SettingsSection
                title={t`Sign-in button`}
                titleProps={SETTINGS_CARD_TITLE_PROPS}
                stackProps={SETTINGS_CARD_STACK_PROPS}
              >
                <FormTextInput
                  name="oidc-login-prompt"
                  label={t`Button label`}
                  placeholder={t`Sign in with SSO`}
                  nullable
                  {...getExtraFormFieldProps(
                    settingDetails["oidc-login-prompt"],
                  )}
                />
              </SettingsSection>
              <SettingsSection
                title={t`User provisioning`}
                titleProps={SETTINGS_CARD_TITLE_PROPS}
                stackProps={SETTINGS_CARD_STACK_PROPS}
              >
                <FormSwitch
                  name="oidc-user-provisioning-enabled?"
                  label={t`Create an account for people who sign in for the first time`}
                  description={t`When this is off, only people who already have an account can sign in with OpenID Connect.`}
                />
                <FormTextInput
                  name="oidc-allowed-email-domains"
                  label={t`Allowed email domains`}
                  placeholder="example.com, example.org"
                  nullable
                  {...getExtraFormFieldProps(
                    settingDetails["oidc-allowed-email-domains"],
                  )}
                />
              </SettingsSection>
              <CollapsibleSettingsSection
                title={t`Attributes`}
                description={t`Choose the ID token or userinfo claims that hold each person's details. Use the full name of a namespaced claim, such as https://example.com/claims/roles, or a dotted path to a nested one.`}
              >
                <Stack gap="lg">
                  <FormTextInput
                    name="oidc-attribute-email"
                    label={t`Email claim`}
                    placeholder={getDefaultPlaceholder(
                      settingDetails["oidc-attribute-email"],
                    )}
                    nullable
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-attribute-email"],
                    )}
                  />
                  <FormTextInput
                    name="oidc-attribute-firstname"
                    label={t`First name claim`}
                    placeholder={getDefaultPlaceholder(
                      settingDetails["oidc-attribute-firstname"],
                    )}
                    nullable
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-attribute-firstname"],
                    )}
                  />
                  <FormTextInput
                    name="oidc-attribute-lastname"
                    label={t`Last name claim`}
                    placeholder={getDefaultPlaceholder(
                      settingDetails["oidc-attribute-lastname"],
                    )}
                    nullable
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-attribute-lastname"],
                    )}
                  />
                  <FormTextarea
                    name="oidc-user-attributes"
                    label={t`User attributes`}
                    placeholder={
                      "country\norg_id=https://example.com/claims/org.id"
                    }
                    nullable
                    autosize
                    minRows={2}
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-user-attributes"],
                    )}
                  />
                </Stack>
              </CollapsibleSettingsSection>
              <CollapsibleSettingsSection
                title={t`Advanced`}
                description={t`Most providers work without changing these.`}
              >
                <Stack gap="lg">
                  <FormTextInput
                    name="oidc-scopes"
                    label={t`Scopes`}
                    placeholder={getDefaultPlaceholder(
                      settingDetails["oidc-scopes"],
                    )}
                    nullable
                    {...getExtraFormFieldProps(settingDetails["oidc-scopes"])}
                  />
                  <FormTextarea
                    name="oidc-authorization-params"
                    label={t`Extra authorization parameters`}
                    placeholder={
                      "audience=https://api.example.com\nprompt=login"
                    }
                    nullable
                    autosize
                    minRows={2}
                    {...getExtraFormFieldProps(
                      settingDetails["oidc-authorization-params"],
                    )}
                  />
                </Stack>
              </CollapsibleSettingsSection>
              <SettingsGroupMappingSection
                syncSettingKey="oidc-group-sync"
                mappingsSettingKey="oidc-group-mappings"
                description={t`Automatically assign people to ${applicationName} groups based on the groups or roles your identity provider sends`}
                tenancy="internal"
                nameLabel={t`Group or role name`}
                namePlaceholder="analysts"
                disabled={!isConfigured}
              >
                <FormTextInput
                  name="oidc-attribute-groups"
                  label={t`Groups claim`}
                  placeholder="groups"
                  nullable
                  {...getExtraFormFieldProps(
                    settingDetails["oidc-attribute-groups"],
                  )}
                />
              </SettingsGroupMappingSection>
              <Flex justify="end" gap="md">
                <Box>
                  <FormErrorMessage />
                </Box>
                <FormSubmitButton
                  disabled={!dirty && isEnabled}
                  label={isEnabled ? t`Save changes` : t`Save and enable`}
                  variant="filled"
                />
              </Flex>
            </Stack>
            <LeaveRouteConfirmModal isEnabled={dirty && !isSubmitting} />
          </Form>
        )}
      </FormProvider>
    </SettingsPageWrapper>
  );
}

function RedirectUri({ redirectUri }: { redirectUri: string | null }) {
  if (redirectUri == null) {
    return (
      <Text c="text-secondary">
        {t`Set the site URL in the General settings to see the redirect URI to register with your identity provider.`}
      </Text>
    );
  }

  return (
    <CopyTextInput
      label={t`Redirect URI`}
      description={t`Register this as an allowed callback URL of the application at your identity provider.`}
      value={redirectUri}
    />
  );
}

function ConnectionCheck() {
  const { values } = useFormikContext<OidcFormValues>();
  const [checkConnection, { isLoading }] = useCheckOidcConnectionMutation();
  const [result, setResult] = useState<OidcConnectionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issuerUri = values["oidc-issuer-uri"];
  const clientId = values["oidc-client-id"];
  const canCheck = Boolean(issuerUri && clientId);

  const handleCheck = async () => {
    if (!issuerUri || !clientId) {
      return;
    }
    setResult(null);
    setError(null);
    try {
      setResult(
        await checkConnection({
          "issuer-uri": issuerUri,
          "client-id": clientId,
          "client-secret": values["oidc-client-secret"],
        }).unwrap(),
      );
    } catch (checkError) {
      setError(
        getErrorMessage(checkError, t`The connection could not be checked`),
      );
    }
  };

  return (
    <Stack gap="sm" align="flex-start">
      <Button
        onClick={handleCheck}
        disabled={!canCheck}
        loading={isLoading}
      >{t`Check connection`}</Button>
      {error && <Text c="feedback-negative">{error}</Text>}
      {result && <ConnectionCheckResult result={result} />}
    </Stack>
  );
}

function ConnectionCheckResult({ result }: { result: OidcConnectionCheck }) {
  const steps = [
    { label: t`Discovery`, step: result.discovery },
    ...(result.credentials
      ? [{ label: t`Client credentials`, step: result.credentials }]
      : []),
  ];

  return (
    <Stack gap="xs" data-testid="oidc-connection-check">
      {steps.map(({ label, step }) => {
        const isConfirmed = step.success && step.verified !== false;
        return (
          <Flex key={label} gap="sm" align="flex-start">
            <Icon
              name={isConfirmed ? "check_filled" : "warning"}
              c={step.success ? "feedback-positive" : "feedback-negative"}
              mt="2px"
              aria-hidden
            />
            <Text>
              <Text span fw="bold">{`${label}: `}</Text>
              {step.message}
            </Text>
          </Flex>
        );
      })}
    </Stack>
  );
}
