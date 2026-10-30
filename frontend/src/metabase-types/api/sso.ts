import type { EnterpriseSettings } from "./settings";

/** `GET /api/sso/oidc`: what the OpenID Connect settings page shows besides the settings themselves. */
export interface OidcSsoInfo {
  /** The redirect URI to register with the identity provider; `null` until the site URL is known. */
  "redirect-uri": string | null;
  /** Whether `MB_ENCRYPTION_SECRET_KEY` is set, which OpenID Connect sign-in needs. */
  "encryption-enabled": boolean;
}

export type OidcSsoSettings = Partial<
  Pick<
    EnterpriseSettings,
    | "oidc-enabled"
    | "oidc-issuer-uri"
    | "oidc-client-id"
    | "oidc-client-secret"
    | "oidc-scopes"
    | "oidc-authorization-params"
    | "oidc-login-prompt"
    | "oidc-attribute-email"
    | "oidc-attribute-firstname"
    | "oidc-attribute-lastname"
    | "oidc-attribute-groups"
    | "oidc-user-attributes"
    | "oidc-user-provisioning-enabled?"
    | "oidc-allowed-email-domains"
  >
>;

export type JwtSsoSettings = Partial<
  Pick<
    EnterpriseSettings,
    | "jwt-enabled"
    | "jwt-identity-provider-uri"
    | "jwt-shared-secret"
    | "jwt-attribute-email"
    | "jwt-attribute-firstname"
    | "jwt-attribute-lastname"
    | "jwt-attribute-groups"
    | "jwt-user-attributes"
    | "jwt-user-provisioning-enabled?"
  >
>;

export interface OidcConnectionCheckRequest {
  "issuer-uri": string;
  "client-id": string;
  /** Leave out, or send the masked value, to check the saved secret. */
  "client-secret"?: string | null;
}

export interface OidcConnectionCheckStep {
  success: boolean;
  verified?: boolean;
  message?: string | null;
}

/** `POST /api/sso/oidc/check` */
export interface OidcConnectionCheck {
  ok: boolean;
  issuer?: string | null;
  discovery: OidcConnectionCheckStep;
  credentials?: OidcConnectionCheckStep;
}
