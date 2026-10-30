import { t } from "ttag";

import type {
  AuthProvider,
  AuthProviderButtonProps,
} from "metabase/plugins/types";
import MetabaseSettings from "metabase/utils/settings";

import { SsoLoginButton } from "./components/SsoLoginButton";
import { JWT_LOGIN_PATH, OIDC_LOGIN_PATH } from "./utils";

function OidcLoginButton(props: AuthProviderButtonProps) {
  const loginPrompt = MetabaseSettings.get("oidc-login-prompt");

  return (
    <SsoLoginButton
      {...props}
      path={OIDC_LOGIN_PATH}
      label={loginPrompt || t`Sign in with SSO`}
    />
  );
}

function JwtLoginButton(props: AuthProviderButtonProps) {
  return (
    <SsoLoginButton
      {...props}
      path={JWT_LOGIN_PATH}
      label={t`Sign in with SSO`}
    />
  );
}

const OIDC_PROVIDER: AuthProvider = { name: "oidc", Button: OidcLoginButton };
const JWT_PROVIDER: AuthProvider = { name: "jwt", Button: JwtLoginButton };

/**
 * Puts a sign-in button first for each enabled single sign-on method, and
 * drops the email and password option when an admin turned password login
 * off. LDAP signs in through that same form, so it stays while LDAP is on.
 *
 * The plugin signature passes no state, so the settings are read the way the
 * other auth provider plugins read them.
 */
export function getSsoAuthProviders(providers: AuthProvider[]): AuthProvider[] {
  const ssoProviders = [
    ...(MetabaseSettings.get("oidc-enabled") ? [OIDC_PROVIDER] : []),
    ...(MetabaseSettings.get("jwt-enabled") ? [JWT_PROVIDER] : []),
  ];

  const isPasswordFormAvailable =
    MetabaseSettings.get("enable-password-login") !== false ||
    Boolean(MetabaseSettings.get("ldap-enabled"));

  const otherProviders = isPasswordFormAvailable
    ? providers
    : providers.filter((provider) => provider.name !== "password");

  return [...ssoProviders, ...otherProviders];
}
