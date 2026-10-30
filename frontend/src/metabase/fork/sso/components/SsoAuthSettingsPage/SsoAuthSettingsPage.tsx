import { t } from "ttag";

import { ApiKeysAuthCard } from "metabase/admin/settings/auth/components/ApiKeysAuthCard";
import { GoogleAuthCard } from "metabase/admin/settings/auth/containers/GoogleAuthCard";
import { LdapAuthCard } from "metabase/admin/settings/auth/containers/LdapAuthCard";
import { ManageApiKeys } from "metabase/admin/settings/components/ApiKeys/ManageApiKeys";
import {
  type AuthSettingsPageProps,
  PLUGIN_MULTI_FACTOR_AUTH,
} from "metabase/plugins";
import { SettingsPageWrapper } from "metabase/settings-components";
import { Stack } from "metabase/ui";

import { JwtAuthCard, OidcAuthCard } from "./SsoAuthCards";
import {
  NewSsoUserEmailSettings,
  PasswordLoginSettings,
} from "./SsoLoginSettings";

/**
 * The authentication overview: every sign-in method with its status, and the
 * settings that span them. The API keys tab is the same as without SSO.
 */
export function SsoAuthSettingsPage({ tab }: AuthSettingsPageProps) {
  if (tab === "api-keys") {
    return <ManageApiKeys />;
  }

  return (
    <SettingsPageWrapper title={t`Authentication`}>
      <Stack gap="xl">
        <GoogleAuthCard />
        <LdapAuthCard />
        <OidcAuthCard />
        <JwtAuthCard />
        <ApiKeysAuthCard />
        <PLUGIN_MULTI_FACTOR_AUTH.AdminAuthCard />
        <PasswordLoginSettings />
        <NewSsoUserEmailSettings />
      </Stack>
    </SettingsPageWrapper>
  );
}
