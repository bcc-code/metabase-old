import { t } from "ttag";

import { AuthCard } from "metabase/admin/settings/auth/components/AuthCard";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import { useSelector } from "metabase/redux";
import { getApplicationName } from "metabase/selectors/whitelabel";
import { useAdminSetting } from "metabase/settings";

/** Deactivating clears the settings that make OpenID Connect configured. */
const OIDC_DEACTIVATED_SETTINGS = {
  "oidc-enabled": false,
  "oidc-issuer-uri": null,
  "oidc-client-id": null,
  "oidc-client-secret": null,
};

/** Deactivating clears the settings that make JWT configured. */
const JWT_DEACTIVATED_SETTINGS = {
  "jwt-enabled": false,
  "jwt-identity-provider-uri": null,
  "jwt-shared-secret": null,
};

export function OidcAuthCard() {
  const { value: isConfigured, isLoading } = useAdminSetting("oidc-configured");
  const {
    value: isEnabled,
    settingDetails,
    updateSetting,
    updateSettings,
  } = useAdminSetting("oidc-enabled");

  if (isLoading) {
    return <LoadingAndErrorWrapper loading />;
  }

  return (
    <AuthCard
      type="oidc"
      name={t`OpenID Connect`}
      description={t`Allows people to sign in with any OpenID Connect identity provider, such as Auth0, Okta, Keycloak or Microsoft Entra ID, and keeps their names, groups and attributes in sync.`}
      isConfigured={Boolean(isConfigured)}
      isEnabled={Boolean(isEnabled)}
      setting={settingDetails}
      onChange={(value) => updateSetting({ key: "oidc-enabled", value })}
      onDeactivate={() => updateSettings(OIDC_DEACTIVATED_SETTINGS)}
    />
  );
}

export function JwtAuthCard() {
  const applicationName = useSelector(getApplicationName);
  const { value: isConfigured, isLoading } = useAdminSetting("jwt-configured");
  const {
    value: isEnabled,
    settingDetails,
    updateSetting,
    updateSettings,
  } = useAdminSetting("jwt-enabled");

  if (isLoading) {
    return <LoadingAndErrorWrapper loading />;
  }

  return (
    <AuthCard
      type="jwt"
      name={t`JWT`}
      description={t`Allows people to sign in through an identity provider that sends ${applicationName} a signed JSON Web Token, and keeps their groups and attributes in sync.`}
      isConfigured={Boolean(isConfigured)}
      isEnabled={Boolean(isEnabled)}
      setting={settingDetails}
      onChange={(value) => updateSetting({ key: "jwt-enabled", value })}
      onDeactivate={() => updateSettings(JWT_DEACTIVATED_SETTINGS)}
    />
  );
}
