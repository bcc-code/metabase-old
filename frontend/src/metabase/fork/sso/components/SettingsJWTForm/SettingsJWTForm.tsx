import type { FormikHelpers } from "formik";
import { useCallback, useMemo } from "react";
import { t } from "ttag";
import * as Yup from "yup";

import { SettingsGroupMappingSection } from "metabase/admin/settings/auth/components/GroupMappings";
import {
  getDefaultPlaceholder,
  getExtraFormFieldProps,
  getStoredFieldValue,
} from "metabase/admin/settings/utils";
import { LeaveRouteConfirmModal } from "metabase/common/components/LeaveConfirmModal";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import {
  Form,
  FormErrorMessage,
  FormProvider,
  FormSecretKey,
  FormSubmitButton,
  FormSwitch,
  FormTextInput,
  FormTextarea,
} from "metabase/forms";
import type { SettingsJWTFormProps } from "metabase/plugins";
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
import { Box, Flex, Stack } from "metabase/ui";
import * as Errors from "metabase/utils/errors";
import type {
  EnterpriseSettings,
  JwtSsoSettings,
  SettingDefinition,
  SettingDefinitionMap,
} from "metabase-types/api";

import { useUpdateJwtSsoSettingsMutation } from "../../api";
import { JWT_LOGIN_PATH, getSsoLoginUrl, isHttpUrl } from "../../utils";

type JwtTextKey = keyof Pick<
  JwtSsoSettings,
  | "jwt-identity-provider-uri"
  | "jwt-shared-secret"
  | "jwt-attribute-email"
  | "jwt-attribute-firstname"
  | "jwt-attribute-lastname"
  | "jwt-attribute-groups"
  | "jwt-user-attributes"
>;

export type JwtFormValues = Record<JwtTextKey, string | null> & {
  "jwt-user-provisioning-enabled?": boolean;
};

/** An env-managed setting shows where its value comes from instead of `description`. */
const withDescription = (
  setting: SettingDefinition | undefined,
  description: string,
) => {
  const fieldProps = getExtraFormFieldProps(setting);
  return setting?.is_env_setting ? fieldProps : { ...fieldProps, description };
};

const getJwtSchema = () =>
  Yup.object({
    "jwt-identity-provider-uri": Yup.string()
      .nullable()
      .required(Errors.required)
      .test(
        "http-url",
        () => t`Enter a URL that starts with https:// or http://`,
        (value) => value == null || isHttpUrl(value),
      ),
    "jwt-shared-secret": Yup.string().nullable().required(Errors.required),
  });

export const getJwtFormValues = (
  settingDetails: SettingDefinitionMap,
  settingValues: EnterpriseSettings,
): JwtFormValues => {
  const storedValue = (key: JwtTextKey) =>
    getStoredFieldValue(settingDetails[key], settingValues[key]);

  return {
    "jwt-identity-provider-uri": storedValue("jwt-identity-provider-uri"),
    "jwt-shared-secret": storedValue("jwt-shared-secret"),
    "jwt-attribute-email": storedValue("jwt-attribute-email"),
    "jwt-attribute-firstname": storedValue("jwt-attribute-firstname"),
    "jwt-attribute-lastname": storedValue("jwt-attribute-lastname"),
    "jwt-attribute-groups": storedValue("jwt-attribute-groups"),
    "jwt-user-attributes": storedValue("jwt-user-attributes"),
    "jwt-user-provisioning-enabled?":
      settingValues["jwt-user-provisioning-enabled?"] ?? true,
  };
};

/**
 * The JWT single sign-on settings page, at Admin > Settings > Authentication >
 * JWT. A `null` title leaves the heading to the page that embeds the form.
 */
export function SettingsJWTForm({ title }: SettingsJWTFormProps) {
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
  const [updateJwtSettings] = useUpdateJwtSsoSettingsMutation();
  const applicationName = useSelector(getApplicationName);
  const schema = useMemo(getJwtSchema, []);

  const isEnabled = Boolean(settingValues?.["jwt-enabled"]);
  const isConfigured = Boolean(settingValues?.["jwt-configured"]);

  const handleSubmit = useCallback(
    async (values: JwtFormValues, helpers: FormikHelpers<JwtFormValues>) => {
      await updateJwtSettings({ ...values, "jwt-enabled": true }).unwrap();
      helpers.resetForm({ values });
    },
    [updateJwtSettings],
  );

  if (isLoadingDetails || isLoadingValues) {
    return <LoadingAndErrorWrapper loading />;
  }

  if (!settingDetails || !settingValues || detailsError || valuesError) {
    return <LoadingAndErrorWrapper error={t`Error loading the JWT settings`} />;
  }

  const loginUrl = `${window.location.origin}${getSsoLoginUrl(JWT_LOGIN_PATH)}`;

  return (
    <SettingsPageWrapper
      title={title === undefined ? t`JWT` : title}
      description={t`${applicationName} sends people to your identity provider to sign in. The provider signs a JSON Web Token (HS256) with the shared signing key and sends them back to ${loginUrl} with the token in the jwt parameter and the page to open in return_to.`}
    >
      <FormProvider
        initialValues={getJwtFormValues(settingDetails, settingValues)}
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
                  <FormTextInput
                    name="jwt-identity-provider-uri"
                    label={t`JWT identity provider URI`}
                    placeholder="https://login.example.com/metabase"
                    required
                    autoFocus
                    {...getExtraFormFieldProps(
                      settingDetails["jwt-identity-provider-uri"],
                    )}
                  />
                  <FormSecretKey
                    name="jwt-shared-secret"
                    label={t`String used by the JWT signing key`}
                    required
                    {...withDescription(
                      settingDetails["jwt-shared-secret"],
                      t`Generate a key and give it to your identity provider, which signs each token with it.`,
                    )}
                  />
                </Stack>
              </SettingsSection>
              <SettingsSection
                title={t`User provisioning`}
                titleProps={SETTINGS_CARD_TITLE_PROPS}
                stackProps={SETTINGS_CARD_STACK_PROPS}
              >
                <FormSwitch
                  name="jwt-user-provisioning-enabled?"
                  label={t`Create an account for people who sign in for the first time`}
                  description={t`When this is off, only people who already have an account can sign in with JWT.`}
                />
              </SettingsSection>
              <CollapsibleSettingsSection
                title={t`Attributes`}
                description={t`Choose the JWT claims that hold each person's details. Use the full name of a namespaced claim, or a dotted path to a nested one.`}
              >
                <Stack gap="lg">
                  <FormTextInput
                    name="jwt-attribute-email"
                    label={t`Email attribute`}
                    placeholder={getDefaultPlaceholder(
                      settingDetails["jwt-attribute-email"],
                    )}
                    nullable
                    {...getExtraFormFieldProps(
                      settingDetails["jwt-attribute-email"],
                    )}
                  />
                  <FormTextInput
                    name="jwt-attribute-firstname"
                    label={t`First name attribute`}
                    placeholder={getDefaultPlaceholder(
                      settingDetails["jwt-attribute-firstname"],
                    )}
                    nullable
                    {...getExtraFormFieldProps(
                      settingDetails["jwt-attribute-firstname"],
                    )}
                  />
                  <FormTextInput
                    name="jwt-attribute-lastname"
                    label={t`Last name attribute`}
                    placeholder={getDefaultPlaceholder(
                      settingDetails["jwt-attribute-lastname"],
                    )}
                    nullable
                    {...getExtraFormFieldProps(
                      settingDetails["jwt-attribute-lastname"],
                    )}
                  />
                  <FormTextarea
                    name="jwt-user-attributes"
                    label={t`User attributes`}
                    placeholder={"department\norg_id=org.id"}
                    nullable
                    autosize
                    minRows={2}
                    {...getExtraFormFieldProps(
                      settingDetails["jwt-user-attributes"],
                    )}
                  />
                </Stack>
              </CollapsibleSettingsSection>
              <SettingsGroupMappingSection
                syncSettingKey="jwt-group-sync"
                mappingsSettingKey="jwt-group-mappings"
                description={t`Automatically assign people to ${applicationName} groups based on the groups in their JWT`}
                tenancy="internal"
                nameLabel={t`JWT group name`}
                namePlaceholder="analysts"
                disabled={!isConfigured}
              >
                <FormTextInput
                  name="jwt-attribute-groups"
                  label={t`Group assignment attribute`}
                  placeholder={getDefaultPlaceholder(
                    settingDetails["jwt-attribute-groups"],
                  )}
                  nullable
                  {...getExtraFormFieldProps(
                    settingDetails["jwt-attribute-groups"],
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
