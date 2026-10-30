# BCC Metabase fork

This is BCC's self-hosted fork of [Metabase](https://github.com/metabase/metabase). It ships the **open-source
(AGPL) edition** plus BCC's own implementations of features that upstream Metabase only offers in its paid edition:

| Feature | Where admins find it |
|---|---|
| [Single sign-on: OpenID Connect and JWT](#single-sign-on-openid-connect-and-jwt) | Admin → Settings → Authentication |
| [Row- and column-level security](#row--and-column-level-security) | Admin → Permissions |
| [Advanced permissions](#advanced-permissions) | Admin → Permissions |
| [Granular caching](#granular-caching) | Admin → Performance, dashboard and question settings |
| [White-labeling (with a BCC theme)](#white-labeling) | Admin → Settings → Appearance |
| [Custom visualizations](#custom-visualizations) | Admin → Settings → Custom visualizations |
| [Git sync](#git-sync) | Admin → Settings → Git sync, Data Studio → Git sync |
| [No upgrade advertising](#no-upgrade-advertising) | everywhere |

## Licensing: why none of this touches `enterprise/`

Code under `enterprise/` is under the Metabase Commercial License and may not be used without a paid license. This
fork **does not use it**: every feature above is an independent implementation in the AGPL parts of the repo
(`src/`, `test/`, `resources/`, `frontend/src/`). Build and run the OSS edition only (the default; never set
`MB_EDITION=ee`, never use the `:ee` / `:ee-dev` deps aliases). The `enterprise/` directory is left in the tree only
so upstream merges stay simple; you may delete it from your builds.

How the fork plugs in, so upstream merges stay easy:

- `src/metabase/premium_features/fork_features.clj` lists the features the fork provides. Feature checks
  (`has-feature?`, the `token-features` setting the frontend reads) report them as available without a token.
- Backend behaviour lives in the OSS fallback bodies of upstream's `defenterprise` hooks, or in new OSS modules
  (`metabase.custom-viz`, `metabase.data-access`, ...) owned by team "BCC" in `.clj-kondo/config/modules/config.edn`.
- Frontend code lives in `frontend/src/metabase/fork/<feature>/`. `initializeForkPlugins()`
  (`frontend/src/metabase/fork/index.ts`, called from `app.tsx`) fills upstream's `PLUGIN_*` slots, just as the
  enterprise build's `initializePlugins()` would.

## Build and deploy

```bash
docker build -t bcc-metabase .
```

The root `Dockerfile` builds the OSS edition by default. Without Docker: `./bin/build.sh` (needs Java 21+, the
Clojure CLI and Bun), which produces `target/uberjar/metabase.jar`.

Environment variables you should set in production:

| Variable | Why |
|---|---|
| `MB_ENCRYPTION_SECRET_KEY` | **Required for OIDC** (encrypts the login state cookie and secrets such as the OIDC client secret and the Git token). Use a long random string and keep it stable. |
| `MB_SITE_URL` | The public `https://` address. The OIDC redirect URI is built from it. |
| `MB_DB_TYPE`, `MB_DB_CONNECTION_URI` | Use Postgres for the application database in production. |
| `MB_APPLICATION_COLORS`, `MB_APPLICATION_FONT` | Optional: bake the BCC theme in at deploy time (see [White-labeling](#white-labeling)). |
| `MB_CACHE_REFRESH_TRIGGER_SECRET` | Only on hosts that give background work no CPU, such as Cloud Run with request-based billing: see [Running on Cloud Run](#running-on-cloud-run). |

## Development

```bash
bun install
bun run build:cljs                 # ClojureScript, needed by type-check and Jest
bun run type-check-pure
./bin/test-agent --oss :only '[metabase.sso.integrations.oidc-test]'
```

Always pass `--oss` to the test runner: without it the runner puts `enterprise/` code on the classpath, which this
fork must not use (and whose settings collide with the fork's). The checked-in OpenAPI spec
(`resources/openapi/openapi.json`) describes the fork's API; `bun run generate-openapi` regenerates it, in OSS mode.

## Single sign-on: OpenID Connect and JWT

Admin → Settings → Authentication has **OpenID Connect** and **JWT** pages. Both are generic: they work with any
standards-compliant provider, including `login.bcc.no`.

### OpenID Connect

1. At your identity provider, create a web application ("Regular Web Application" in Auth0) using the
   Authorization Code flow, with this callback / redirect URI (the OIDC settings page shows the exact value):
   `https://<metabase-host>/auth/sso/oidc/callback`
2. Set `MB_ENCRYPTION_SECRET_KEY` and `MB_SITE_URL` on the server (see above).
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

### JWT

The classic Metabase JWT flow, compatible with upstream's `MB_JWT_*` settings: Metabase sends users to your identity
provider URI with `return_to`; the provider sends them back to `https://<metabase-host>/auth/sso?jwt=<token>&return_to=<path>`
with an HS256/384/512 token signed with the shared secret (generate it on the JWT page). Tokens must carry `iat` and
be at most 3 minutes old. Same attribute, group-mapping and provisioning options as OIDC.

### Password login

Once SSO works you can turn off **Enable password authentication** on the Authentication overview (this applies to
admins too).

Limitations: one OIDC provider at a time; no single logout; a JWT can be replayed within its ~4-minute validity
window; on a sub-path deployment, SSO error redirects go to `/auth/login` without the sub-path.

## Row- and column-level security

Admin → Permissions → Data → a group → a database → a table, **View data**:

- **Row and column security**: the group sees the table through a policy.
  - *Filter by a column in the table*: map a **user attribute** to a column (e.g. attribute `country` → column `Country`); each
    user only sees rows matching their own attribute value(s). A list-valued attribute matches any of its values; a
    user without the attribute gets an error, never unfiltered data.
  - *Use a saved question to create a custom view for this table*: pick a question or model on that table that returns only the allowed rows and
    **columns** (column-level security); optionally pass attributes into its columns or `{{variables}}`.
- **Blocked**: the group can't see the table/schema/database at all, not even through saved questions or dashboards.
- **Impersonated** (database level, Postgres and other drivers that support roles): queries run as the database role
  named in a user attribute, so the database's own grants decide what people see. Create the roles and grants in the
  database; MySQL, Snowflake and SQL Server need a default role in the connection settings.

User attributes: Admin → People → a user → **Edit user** → **Attributes**, or sent by your identity provider through SSO (see
"user attributes from claims"); an admin-set attribute wins over one from SSO.

How it behaves: every query a non-admin runs on a restricted table (directly, through joins, saved questions,
models and implicit joins) reads the policy's filtered version instead; columns a policy drops disappear from
results and metadata; filter values are computed per policy; sandboxed users can't run native SQL on that database;
cached results are kept separate per policy and attribute values. Admins, and admin-run contexts such as public
links and static embeds, are never restricted. If a user is in several groups, a group with unrestricted access to
the table lifts the restriction, identical policies are fine, and different policies on the same table are an
error. A saved question that a policy uses can't be deleted or edited into something that breaks the policy.

New groups and new databases start with "Can view", as in upstream's open-source edition: restrict All Users first.
Policies are not part of Git sync.

## Advanced permissions

Admin → Permissions → **Data** (per group, per database, with "Granular" for schemas and tables):

| Column | Options | Effect |
|---|---|---|
| Download results | 1 million rows / 10 thousand rows / Granular / No | Enforced on CSV, XLSX and JSON downloads of questions, dashboards, documents and ad-hoc queries, and on subscription/alert attachments. Native queries use the database-wide level. |
| Manage table metadata | Edit / Granular / No | Those users get Admin → Table Metadata for the granted tables. |
| Manage database | Yes / No | Those users get Admin → Databases for the granted databases (edit connection, sync, scan; not add or delete). |

Admin → Permissions → **Application** (per group):

- **Settings access**: the admin settings pages that aren't security-sensitive. Settings managers can never change
  sign-in, SSO, MFA, passwords and sessions, API keys, the site URL, SMTP, embedding/CORS/CSP, AI provider and
  Metabot settings, custom visualizations or Git sync (enforced by the API, not just hidden), nor Permissions and
  People.
- **Monitoring access**: tools, troubleshooting and logs.
- **Subscriptions and alerts**: who can create them (All Users by default; revoke there and grant to specific groups).

**Group managers**: Admin → People → Groups → a group → set a member's type to **Manager**. Managers can add and
remove members of their own groups and rename or delete them.

Across groups the most permissive grant wins; for downloads, a query gets the most restrictive level of the tables
it reads. The application-permissions API is `GET/PUT /api/permissions/application/graph` (upstream's paid edition
uses a different path).

## Granular caching

- **Admin → Performance → Database caching**: a default policy plus a policy per database; "Clear cache for this
  database", "Clear all cached results", "Reset all to default".
- **Admin → Performance → Dashboard and question caching**: every dashboard and question with its own policy, with
  edit and reset.
- **Dashboard settings, question settings, metric caching**: "When to get new results" and "Clear cache".

Policies: **Adaptive** (cache for a multiple of the average run time), **Duration** (fixed hours/minutes),
**Schedule** (results go stale when a cron schedule fires, in the report timezone) and **Don't cache**. The most
specific policy wins: question → dashboard (when the question runs on that dashboard) → database → default. A
background job records schedule runs every minute; nothing needs configuring (but see
[Running on Cloud Run](#running-on-cloud-run)).

Models use model persistence instead of a caching policy.

### Refresh cache automatically

A question's or dashboard's **Duration** or **Schedule** policy has a **Refresh cache automatically** switch. With
it on, Metabase runs the queries again as soon as their cached results go stale, so people are served from the cache
instead of waiting:

- **Schedule**: right after the schedule fires.
- **Duration**: shortly before the results expire: 2 minutes plus the last 10% of the duration
  (`MB_QUERY_CACHING_EARLY_REFRESH_RATIO`, default 0.1) before.
- Either: right after someone clears the cache of the question, dashboard or database.

What runs again is what people ran: per question, the (up to) 10 combinations of filter values applied most often
during the last caching period, or the last one applied when nobody ran it during that period. A question nobody has
ever run is left alone. On a dashboard, the policy covers the cards without a policy of their own, with the filter
values applied on that dashboard.

Questions on a database with row- and column-level security or connection impersonation are **not** refreshed:
their results differ from person to person, so there is no single result to keep warm. Their caching still works
for queries people run.

The refresh runs show up in the query log (`query_execution`) with context `cache-refresh`. A background job checks
every minute what is due. With several Metabase instances on one application database, each policy is refreshed by
one instance only.

### Running on Cloud Run

Metabase runs its background jobs (automatic cache refreshing, but also alerts, dashboard subscriptions, database
sync and scheduled Git sync imports) inside the server process. With Cloud Run's **request-based billing** an
instance gets no CPU between requests, and it is shut down when nobody uses Metabase, so those jobs stall.

**Recommended**: give the service CPU all the time and keep one instance running. Then everything, automatic cache
refreshing included, works with nothing else to set up:

```bash
gcloud run services update metabase --no-cpu-throttling --min-instances=1
```

**If you keep request-based billing**, let Cloud Scheduler call `POST /api/cache-refresh/run` every minute. The
endpoint does a refresh pass (and records cache schedule runs) while the request is open, so it gets the CPU it needs,
and returns how much it refreshed. This covers automatic cache refreshing only, not the other background jobs.

1. Generate a secret of at least 32 characters, store it in Secret Manager and expose it to the service as
   `MB_CACHE_REFRESH_TRIGGER_SECRET`. Without it the endpoint answers 404.

   ```bash
   openssl rand -hex 32 | gcloud secrets create metabase-cache-refresh-secret --data-file=-
   ```

   ```bash
   gcloud run services update metabase \
     --update-secrets=MB_CACHE_REFRESH_TRIGGER_SECRET=metabase-cache-refresh-secret:latest \
     --timeout=3600
   ```

   The longer request timeout lets a pass that reruns many slow queries finish.

2. Create the Cloud Scheduler job. It sends the secret in the `X-Metabase-Cache-Refresh-Secret` header; requests
   without it, or with a different one, get 403. Anyone who can view the scheduler job can read the header, so
   limit who can.

   ```bash
   gcloud scheduler jobs create http metabase-cache-refresh \
     --location=<region> \
     --schedule="* * * * *" \
     --http-method=POST \
     --uri="https://<your Metabase host>/api/cache-refresh/run" \
     --headers="X-Metabase-Cache-Refresh-Secret=<the secret>" \
     --attempt-deadline=30m
   ```

Calls may overlap: a policy that one pass is refreshing isn't refreshed by another. Cloud Tasks works too: create
HTTP tasks with the same method, URL and header. But something has to create a task every minute, which is what Cloud
Scheduler does on its own.

## White-labeling

Admin → Settings → Appearance:

- **Branding**: **Use BCC theme** (BCC Design System: BCC green `#014D49`, its categorical chart hues, and the Archivo
  typeface, which this fork bundles), application name, logo and
  favicon upload, brand / filter / summarize / chart colors, font (bundled, web-safe, or your own font files),
  loading message, and the login, home, "no results" and "nothing found" illustrations.
- **Conceal Metabase**: help link (Metabase, hidden, or your own URL), hide Metabase links and the "Powered by
  Metabase" badge, Metabot greeting.

Branding applies across the app, public links and static embeds, emails, Slack messages and PDF exports ("Made with
Metabase" is gone everywhere). Dark mode lightens a too-dark brand color so text stays readable. The BCC theme takes
its values from the BCC Design System: purple-700 and orange-700 for the query builder's filter and summarize steps
(both readable with white text), and chart colors that avoid red, green and yellow, which the design system reserves
for danger, success and warning.

Tips: upload the logo as PNG or JPEG (email clients can't show SVG logos). To make the BCC look the default at
deploy time instead of clicking the button (values from `frontend/src/metabase/fork/whitelabel/bcc-theme.ts`):

```bash
MB_APPLICATION_FONT=Archivo
MB_APPLICATION_COLORS='{"brand":"#014D49","filter":"#61479C","summarize":"#943A14","accent0":"#1D7F78","accent1":"#9A82DA","accent2":"#DA772E","accent3":"#1A9EB7","accent4":"#DE66B0","accent5":"#A98C66","accent6":"#608EF6","accent7":"#BC870D"}'
```

## Custom visualizations

Admin → Settings → Custom visualizations: upload a visualization bundle (a single JavaScript file, max 5 MB), then
enable, disable, replace or delete it. Enabled visualizations appear in the visualization picker for questions and
dashboard cards, with their own settings in the settings sidebar and normal drill-through.

For developers: the plugin contract (version 1) and a step-by-step guide are in
[`frontend/src/metabase/fork/custom-viz/README.md`](frontend/src/metabase/fork/custom-viz/README.md); a ready-to-upload
example is [`frontend/src/metabase/fork/custom-viz/examples/progress-ring.js`](frontend/src/metabase/fork/custom-viz/examples/progress-ring.js).

**Security:** a bundle runs as trusted code inside Metabase, with the permissions of whoever views it. Only admins
can install bundles; only install code you trust.

Limitations: subscriptions, alerts, public links and static embeds show these cards as a table; the embedding SDK
and the visualizer don't support them; bundles are not part of Git sync.

## Git sync

Admin → Settings → Git sync (also in Data Studio):

1. Connect a repository: HTTPS URL, branch (default `main`) and an access token (GitHub, GitLab, Gitea and Azure
   DevOps tokens work as-is; for Bitbucket put `x-token-auth@` in the URL; SSH URLs aren't supported). **Test
   connection**, choose **read-write** (development) or **read-only** (production), and set the committer name and
   email.
2. Turn on syncing for top-level collections. Everything inside them is synced: questions, models and metrics,
   dashboards (tabs and cards), documents, timelines and events, actions, and the SQL snippets they use.
3. **Export** commits and pushes the synced content; **Import** pulls and applies it. The page lists local changes
   since the last sync and shows progress and conflicts.

A typical setup: authors work on a read-write instance and export; changes are reviewed in Git; production runs
**read-only** with **scheduled import** (every 15 minutes by default) and refuses edits to synced content, even by
admins.

Safety: an export refuses to overwrite branch changes this instance hasn't imported, and an import refuses to
overwrite local changes ("Export anyway" / "Discard local changes and import" override that). Imports run in one
transaction, and only one sync runs at a time.

Repository layout: one YAML file per item under `collections/` and `snippets/` (other files in the repo are left
alone). Databases, tables and fields are referenced by name, so the target instance needs databases with the same
names. Not synced: settings, permissions, users and groups, database and table metadata, segments and measures,
transforms, subscriptions and alerts, custom visualizations.

Settings can be provided with `MB_REMOTE_SYNC_*` environment variables (`MB_REMOTE_SYNC_URL`,
`MB_REMOTE_SYNC_BRANCH`, `MB_REMOTE_SYNC_TOKEN`, `MB_REMOTE_SYNC_TYPE`, `MB_REMOTE_SYNC_AUTO_IMPORT`, ...).

## No upgrade advertising

The fork shows no upsell banners, cards, badges or upgrade modals, no License or Metabase Cloud pages, no store link,
and no "available on Pro/Enterprise" hints. Sections that only existed to sell a paid feature are gone (their routes
show "not found"). Metabase's product-feedback survey emails are off by default (`MB_SURVEYS_ENABLED=true` turns
them back on). A few paid-plan banners remain in the code but only appear with a Metabase license or on Metabase
Cloud, which this fork never has.
