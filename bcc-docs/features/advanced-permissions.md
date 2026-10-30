# Advanced permissions

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
