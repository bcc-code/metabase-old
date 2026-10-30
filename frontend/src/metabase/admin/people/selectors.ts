import type { State } from "metabase/redux/store";
import { getSetting } from "metabase/settings";
import type { EnterpriseSettingKey, User } from "metabase-types/api";

export const getUserTemporaryPassword = (
  state: State,
  props: { userId: number },
) => state.admin.people.temporaryPasswords[props.userId];

const SSO_SOURCE_ENABLED_SETTING = {
  google: "google-auth-enabled",
  ldap: "ldap-enabled",
  saml: "saml-enabled",
  jwt: "jwt-enabled",
  oidc: "oidc-enabled",
  slack: "slack-connect-enabled",
  scim: "scim-enabled",
} as const satisfies Record<
  NonNullable<User["sso_source"]>,
  EnterpriseSettingKey
>;

/**
 * Whether the user signs in through an SSO provider that is currently enabled.
 * Admins can't reset passwords for these users; once the provider is disabled
 * (or its license lapses) the user falls back to password login.
 */
export const getIsUserSsoSourceEnabled = (
  state: State,
  { sso_source }: Pick<User, "sso_source">,
): boolean =>
  sso_source != null &&
  Boolean(getSetting(state, SSO_SOURCE_ENABLED_SETTING[sso_source]));
