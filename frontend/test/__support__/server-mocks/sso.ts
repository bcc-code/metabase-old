import fetchMock from "fetch-mock";

import type { OidcConnectionCheck, OidcSsoInfo } from "metabase-types/api";

export function setupOidcSsoInfoEndpoint(
  info: OidcSsoInfo = {
    "redirect-uri": "http://localhost:3000/auth/sso/oidc/callback",
    "encryption-enabled": true,
  },
) {
  fetchMock.get("path:/api/sso/oidc", info, { name: "oidc-sso-info" });
}

export function setupUpdateOidcSsoSettingsEndpoint({
  status = 200,
  body = { "oidc-enabled": true },
}: { status?: number; body?: unknown } = {}) {
  fetchMock.put(
    "path:/api/sso/oidc/settings",
    { status, body },
    { name: "oidc-sso-settings-put" },
  );
}

export function setupCheckOidcConnectionEndpoint(result: OidcConnectionCheck) {
  fetchMock.post("path:/api/sso/oidc/check", result, {
    name: "oidc-sso-check",
  });
}

export function setupUpdateJwtSsoSettingsEndpoint({
  status = 200,
  body = { "jwt-enabled": true },
}: { status?: number; body?: unknown } = {}) {
  fetchMock.put(
    "path:/api/sso/jwt/settings",
    { status, body },
    { name: "jwt-sso-settings-put" },
  );
}
