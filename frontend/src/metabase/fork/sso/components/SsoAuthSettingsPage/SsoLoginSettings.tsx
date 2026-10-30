import { t } from "ttag";

import { useSetting, useSettingSwitch } from "metabase/settings";
import { SwitchSettingsSection } from "metabase/settings-components";

/** Turning password login off, offered once a single sign-on method is on. */
export function PasswordLoginSettings() {
  const isGoogleEnabled = useSetting("google-auth-enabled");
  const isLdapEnabled = useSetting("ldap-enabled");
  const isOidcEnabled = useSetting("oidc-enabled");
  const isJwtEnabled = useSetting("jwt-enabled");
  const passwordLoginSwitch = useSettingSwitch("enable-password-login");

  const isAnySsoEnabled =
    isGoogleEnabled || isLdapEnabled || isOidcEnabled || isJwtEnabled;

  if (!isAnySsoEnabled) {
    return null;
  }

  return (
    <SwitchSettingsSection
      title={t`Enable password authentication`}
      description={t`Let people sign in with their email address and password. When this is off, everyone, admins included, has to use single sign-on, so check that it works before you turn this off.`}
      checked={passwordLoginSwitch.checked}
      switchDisabled={passwordLoginSwitch.isBusy}
      lockedEnvName={passwordLoginSwitch.envName}
      onChange={passwordLoginSwitch.onChange}
    />
  );
}

export function NewSsoUserEmailSettings() {
  const emailSwitch = useSettingSwitch("send-new-sso-user-admin-email?");

  return (
    <SwitchSettingsSection
      title={t`Notify admins of new SSO users`}
      description={t`Email admins when someone signs in with single sign-on for the first time and gets a new account.`}
      checked={emailSwitch.checked}
      switchDisabled={emailSwitch.isBusy}
      lockedEnvName={emailSwitch.envName}
      onChange={emailSwitch.onChange}
    />
  );
}
