# BCC Metabase

BCC Metabase is BCC's own build of [Metabase](https://www.metabase.com), the open-source tool for asking questions
about data and sharing the answers as charts and dashboards. It runs the **open-source (AGPL) edition** of Metabase
plus features BCC built itself, which upstream Metabase only offers in its paid plans.

For everyday use of Metabase (questions, dashboards, the query builder, SQL), Metabase's own documentation applies:
[metabase.com/docs](https://www.metabase.com/docs/latest/). This site covers what is different in BCC Metabase.

## What BCC Metabase adds

| Feature | Where admins find it |
|---|---|
| [Single sign-on with login.bcc.no](features/sso.md) (OpenID Connect and JWT) | Admin → Settings → Authentication |
| [Row- and column-level security](features/row-and-column-security.md) | Admin → Permissions |
| [Advanced permissions](features/advanced-permissions.md) | Admin → Permissions |
| [Granular caching](features/caching.md), with automatic refreshing | Admin → Performance, dashboard and question settings |
| [White-labeling](features/white-labeling.md), with a BCC theme | Admin → Settings → Appearance |
| [Custom visualizations](features/custom-visualizations.md) | Admin → Settings → Custom visualizations |
| [Git sync](features/git-sync.md) of questions, dashboards and more | Admin → Settings → Git sync, Data Studio → Git sync |
| [Metabot SQL for business users](features/metabot-sql.md) | Account settings → Profile |
| [No upgrade advertising](features/no-upgrade-advertising.md) | everywhere |

## For developers and operators

- [Hosting](hosting.md): how BCC Metabase runs on the BCC Infra Platform, and how to deploy and upgrade it.
- [Development](development/README.md): how the fork is built, tested and kept up to date with upstream Metabase.
- [Building a custom visualization](development/custom-visualizations.md).
