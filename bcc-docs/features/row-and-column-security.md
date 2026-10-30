# Row- and column-level security

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
