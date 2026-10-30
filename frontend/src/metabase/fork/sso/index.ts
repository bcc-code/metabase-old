import {
  PLUGIN_AUTH_PROVIDERS,
  PLUGIN_IS_PASSWORD_USER,
} from "metabase/plugins";

import { SsoAuthSettingsPage } from "./components/SsoAuthSettingsPage";
import { getSsoAuthProviders } from "./login-providers";

/**
 * Single sign-on with OpenID Connect and JWT: the admin settings pages and the
 * sign-in buttons. The flows themselves run in the backend.
 */
export function initializeSsoPlugin() {
  PLUGIN_AUTH_PROVIDERS.AuthSettingsPage = SsoAuthSettingsPage;
  PLUGIN_AUTH_PROVIDERS.settingsJWTForm = () =>
    import(
      /* webpackChunkName: "admin-settings" */ "./components/SettingsJWTForm"
    ).then(({ SettingsJWTForm }) => ({ Component: SettingsJWTForm }));
  PLUGIN_AUTH_PROVIDERS.settingsOIDCForm = () =>
    import(
      /* webpackChunkName: "admin-settings" */ "./components/SettingsOIDCForm"
    ).then(({ SettingsOIDCForm }) => ({ Component: SettingsOIDCForm }));
  PLUGIN_AUTH_PROVIDERS.providers.push(getSsoAuthProviders);
  PLUGIN_IS_PASSWORD_USER.push((user) => user.sso_source !== "oidc");
}
