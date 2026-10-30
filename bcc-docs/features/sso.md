# Single sign-on: OpenID Connect and JWT

Admin → Settings → Authentication has **OpenID Connect** and **JWT** pages. Both are generic: they work with any
standards-compliant provider, including `login.bcc.no`.

## OpenID Connect

1. At your identity provider, create a web application ("Regular Web Application" in Auth0) using the
   Authorization Code flow, with this callback / redirect URI (the OIDC settings page shows the exact value):
   `https://<metabase-host>/auth/sso/oidc/callback`
2. Make sure the server has `MB_ENCRYPTION_SECRET_KEY` and `MB_SITE_URL` set. The BCC hosting sets both (see
   [Hosting](../hosting.md)).
3. In Metabase, enter the **issuer** (for BCC: `https://login.bcc.no/`; pasting the discovery URL also works), the
   **client ID** and the **client secret**. Click **Check connection**, then **Save and enable**.

Optional settings: button label, scopes (default `openid email profile`), extra authorization parameters (e.g.
`audience=...` or `prompt=login`), claim names for email / first name / last name, **groups claim + group mappings**
(claim value → Metabase groups; only mapped groups are touched), **user attributes from claims** (one per line,
`attribute=claim`; used by row-level security), auto-create users on first login, and allowed email domains. Claim
settings accept namespaced claims (`https://login.bcc.no/claims/roles`) and dotted paths to nested claims
(`realm_access.roles`).

Security behaviour: Authorization Code + PKCE (S256), `state` and `nonce` in an encrypted, browser-bound cookie; ID
tokens are verified against the provider's JWKS (RS/PS/ES algorithms, key rotation handled; HS with the client
secret; `none` refused), `iss` must equal the discovery document's issuer, `aud`/`azp`, `exp`/`iat`/`nbf` checked
with 2 minutes of clock skew. Users are matched by the provider's `sub`, then by email. Unverified emails
(`email_verified: false`) are refused, and deactivated Metabase users stay deactivated. Errors return to the login
page with a short message.

**login.bcc.no (Auth0):** email and name arrive with the default scopes. For roles or other attributes add a
Post-Login Action that puts namespaced claims in the ID token, for example:

```js
exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id !== "<metabase client id>") return;
  const ns = "https://login.bcc.no/claims/";
  api.idToken.setCustomClaim(ns + "roles", event.authorization?.roles ?? []);
  api.idToken.setCustomClaim(ns + "country", event.user.app_metadata?.country);
};
```

Then set the groups claim to `https://login.bcc.no/claims/roles` (and map roles to groups) and user attributes to
`country=https://login.bcc.no/claims/country`. `login.bcc.no` has no `end_session_endpoint`, so signing out of
Metabase does not sign you out of login.bcc.no.

All OIDC settings can also be set with `MB_OIDC_*` environment variables (`MB_OIDC_ISSUER_URI`,
`MB_OIDC_CLIENT_ID`, `MB_OIDC_CLIENT_SECRET`, `MB_OIDC_SCOPES`, `MB_OIDC_LOGIN_PROMPT`, `MB_OIDC_ATTRIBUTE_GROUPS`,
`MB_OIDC_GROUP_MAPPINGS`, `MB_OIDC_USER_ATTRIBUTES`, `MB_OIDC_ALLOWED_EMAIL_DOMAINS`, ...).

## JWT

The classic Metabase JWT flow, compatible with upstream's `MB_JWT_*` settings: Metabase sends users to your identity
provider URI with `return_to`; the provider sends them back to `https://<metabase-host>/auth/sso?jwt=<token>&return_to=<path>`
with an HS256/384/512 token signed with the shared secret (generate it on the JWT page). Tokens must carry `iat` and
be at most 3 minutes old. Same attribute, group-mapping and provisioning options as OIDC.

## Password login

Once SSO works you can turn off **Enable password authentication** on the Authentication overview (this applies to
admins too).

Limitations: one OIDC provider at a time; no single logout; a JWT can be replayed within its ~4-minute validity
window; on a sub-path deployment, SSO error redirects go to `/auth/login` without the sub-path.
