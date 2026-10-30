# Git sync

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
