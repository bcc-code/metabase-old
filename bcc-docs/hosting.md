# Hosting BCC Metabase on the BCC Infra Platform

BCC Metabase runs on Google Cloud through the [BCC Infra Platform](https://developer.bcc.no/bcc-platform/). The
Terraform is in the repository's `infra/` folder, and the GitHub workflows in `.github/workflows/`. This page explains
how it fits together and how to deploy and run it. For the features and their settings, see the
[overview](README.md).

The platform decides the parts every BCC project shares:

- **Projects and access.** Each environment gets its own Google Cloud project (`metabase-<environment>-<suffix>`),
  provisioned by the platform. The teams named when provisioning get access through their
  `org-bcc-it-[team]-[role]` groups: developers have full access to sandbox and read-only access to prod, and
  [activate sysadmin](https://developer.bcc.no/bcc-platform/team_access.html) for changes in prod.
- **Terraform runs in GitHub Actions**, through the platform's reusable workflow, with the state kept in the
  platform's storage. Nobody applies Terraform from their own machine.
- **Public traffic goes through the [shared platform gateway](https://developer.bcc.no/bcc-platform-gateway/)**,
  which owns the DNS record, the TLS certificate and the HTTP → HTTPS redirect.
- **Region**: `europe-west4` (Netherlands), the platform's location for every project.

The repository must be a **private** repository in the `bcc-code` organization: the platform only deploys from
those, and a project stays linked to the repository it was provisioned from.

## Architecture

```
            people, public links, embeds
                         │ HTTPS: metabase.bcc.no / metabase.sandbox.bcc.no
                         ▼
   ┌──────────────────────────────────────────────┐
   │ BCC platform gateway (bcc-platform-<tier>)   │  DNS, certificate, HTTP→HTTPS redirect
   └────────────────────┬─────────────────────────┘
                        │ backend service bs-metabase-app-<environment>,
                        │ with Cloud Armor rate limiting (this project)
                        ▼
   ┌──────────────────────────────────────────────┐
   │ Cloud Run service "metabase"                 │  image from this project's Artifact Registry,
   │  CPU always allocated, at least 1 instance   │  secrets from Secret Manager
   └────────────────────┬─────────────────────────┘
                        │ all outbound traffic (Direct VPC egress)
                        ▼
   ┌──────────────────── VPC "metabase-vpc" ─────────────────────────┐
   │                                                                 │
   │   Cloud SQL for PostgreSQL 16         Cloud NAT, one static IP ─┼──► BCC's databases,
   │   (application database, private IP,  ("egress_ip" output)      │    login.bcc.no, SMTP
   │    TLS only, backups + point-in-time recovery)                  │
   └─────────────────────────────────────────────────────────────────┘
```

| Piece | Choice | Why |
|---|---|---|
| Compute | **Cloud Run**, CPU always allocated, at least 1 instance | Metabase runs alerts, dashboard subscriptions, database sync and automatic cache refreshing in the background, which only work when an instance keeps its CPU between requests. |
| Application database | **Cloud SQL for PostgreSQL 16** in this project, private IP only | See [Why not the shared database server](#why-not-the-shared-database-server). |
| Entry point | **Platform gateway** + a backend from [`gateway-backend`](https://github.com/bcc-code/bcc-platform-gateway-tf-modules) with **Cloud Armor** | The platform's rule for public services on GCP. Cloud Run only accepts traffic from the gateway. |
| Outbound traffic | **Direct VPC egress** and **Cloud NAT** with a static IP | Metabase connects to BCC's databases from one known address their firewalls can allow. |
| Secrets | **Secret Manager** | The database password and `MB_ENCRYPTION_SECRET_KEY` never appear in the service definition. |
| Images | **Artifact Registry** in this project, built by GitHub Actions | The platform gives each project a `sa-gha-cicd` service account that may push images and deploy Cloud Run. |

Sizes by environment (each can be overridden, see [Variables](#variables)):

| | prod, staging | sandbox, dev |
|---|---|---|
| Host name | `metabase.bcc.no` (`metabase.staging.bcc.no`) | `metabase.sandbox.bcc.no` (`metabase.dev.bcc.no`) |
| Cloud Run | 2 vCPU / 4 GiB, 1–3 instances | 1 vCPU / 2 GiB, 1 instance |
| Cloud SQL | `db-custom-2-7680` | `db-custom-1-3840` |

Following the platform's [environment naming](https://developer.bcc.no/bcc-platform/environments.html), the
workflows offer **sandbox** (for trying things out, without production data) and **prod**. Add `dev` or `staging` to
their environment lists if you need them.

### Why not the shared database server

The platform offers a database on its shared Postgres server, but Metabase can't use it as its application
database:

- The shared server only accepts IAM authentication. Metabase connects to its application database with a user
  and password and can't refresh short-lived IAM tokens.
- Through the Cloud SQL Auth Proxy the server is reached via a transaction-mode connection pooler, which doesn't
  support the prepared statements and session settings Metabase's database driver relies on.
- Metabase keeps cached query results in its application database, which would weigh on every other project on
  the shared server.

So Metabase gets a small Cloud SQL instance of its own, with daily backups and 7 days of point-in-time recovery.

## Files

In `infra/`:

| File | What it holds |
|---|---|
| `terraform.tf` | Terraform and provider versions, the platform's `azurerm` state backend |
| `variables.tf` | `props` and `deployment_props` (filled in by the platform) and optional settings |
| `main.tf` | Settings per environment, Artifact Registry, Metabase's service account |
| `network.tf` | VPC, private services access for Cloud SQL, Cloud NAT with a static IP |
| `database.tf` | Cloud SQL instance, database and user |
| `secrets.tf` | Database password and encryption key in Secret Manager |
| `cloud_run.tf` | The Metabase service |
| `gateway.tf` | Cloud Armor policy and the backend the platform gateway routes to |
| `monitoring.tf` | Uptime check, and an email alert when `alert_email` is set |

The workflows are in `.github/workflows/`: `bcc-provision-project.yml`, `bcc-infra-deploy.yml` and
`bcc-app-deploy.yml`.

## First deployment

Do sandbox first, then repeat for prod.

1. **Name the team.** In `.github/workflows/bcc-provision-project.yml`, replace `REPLACE-WITH-TEAM` with the BCC
   team (or comma-separated teams) that should have access, such as `data-team`.

2. **Provision the project.** Run **BCC - Provision Project** (Actions → Run workflow) with the environment and
   action `apply`. The platform creates the Google Cloud project, gives the team access, and sets the GitHub
   environment variables `PROPS`, `GCP_PROJECT_ID` and `GCP_REGION`.

3. **Let the build workflow sign in.** Ask the platform team (the `Cross Team - Developers` chat on Teams) for the
   Workload Identity provider that lets GitHub Actions act as the project's `sa-gha-cicd` service account. Set it
   as the GitHub variable `GCP_CICD_WORKLOAD_IDENTITY_PROVIDER` (repository-wide, or per environment).

4. **Create the image registry.** Run **BCC - Deploy Terraform** with action `apply` and deployment targets
   `google_artifact_registry_repository.metabase`.

5. **Build the image.** Run **BCC - Build and deploy Metabase** with the environment and a version such as
   `v0.66.0-bcc.1`. The build compiles the frontend and the backend and takes 30–60 minutes. On this first run it
   only pushes the image, since there is no service to roll it out to yet.

6. **Create everything else.** Run **BCC - Deploy Terraform** with action `apply`. Metabase starts with the image
   from step 5 and creates its tables in the new database, which takes a few minutes. The outputs list
   `egress_ip` and `gateway_route_snippet`.

7. **Route the host name.** Open a pull request in
   [bcc-code/bcc-platform-gateway](https://github.com/bcc-code/bcc-platform-gateway) that adds
   `routes/metabase.yaml` and nothing else, with the project IDs from step 2:

   ```yaml
   # routes/metabase.yaml
   environments:
     sandbox:
       project_id: metabase-sandbox-xxxxxx
     prod:
       project_id: metabase-prod-xxxxxx

   backends:
     app:
       type: cloud_run # bs-metabase-app-<environment>, created in step 6

   hosts:
     - name: web
       hostnames:
         sandbox: [metabase.sandbox.bcc.no]
         prod: [metabase.bcc.no]
       default_backend: app
   ```

   Check first that no other file in `routes/` uses these host names. The platform team reviews and applies it,
   which creates the DNS record and the certificate (a few minutes to become active). You can test before DNS
   resolves: `curl -sv --resolve metabase.bcc.no:443:<gateway IP> https://metabase.bcc.no/api/health`, where the
   gateway IP is what `gateway.bcc.no` (or `gateway.sandbox.bcc.no`) resolves to.

8. **Set up Metabase.** Open the host name and create the first admin account. Then
   [connect login.bcc.no](features/sso.md) (OpenID Connect, with the callback
   `https://metabase.bcc.no/auth/sso/oidc/callback`), [apply the BCC theme](features/white-labeling.md), and lock down
   the "All Users" group ([row- and column-level security](features/row-and-column-security.md)). Give the `egress_ip` output to whoever runs the databases
   Metabase should read, so they can allow it.

## Variables

The platform fills in `props` and `deployment_props`. Anything else goes in the GitHub environment variable
`MAIN_TERRAFORM_VARS`, one `name=value` per line, for example:

```ini
alert_email=data-team@bcc.no
db_high_availability=true
```

| Variable | Default | |
|---|---|---|
| `hostname` | `metabase.bcc.no`, `metabase.<environment>.bcc.no` | Must match the host name in the gateway route. |
| `cpu`, `memory`, `max_instances`, `db_tier` | by environment, see above | |
| `min_instances` | `1` | Keep at least 1. |
| `db_high_availability` | `false` | A standby in a second zone; doubles the database cost. |
| `db_disk_size_gb` | `20` | Grows automatically. |
| `db_deletion_protection` | `true` | |
| `rate_limit_per_minute` | `3000` | Requests per client IP before Cloud Armor answers 429. |
| `alert_email` | none | Email when the health check fails for 5 minutes. |
| `timezone` | `Europe/Oslo` | |
| `extra_env` | `{}` | More Metabase environment variables. No secrets. |

Secrets don't go in variables: the database password and encryption key are generated by Terraform. If you ever
need another secret (such as an SMTP password), add it to the `secrets` call of `bcc-infra-deploy.yml` from a GitHub
secret.

## Upgrades and changes

- **New version of Metabase**: take an on-demand backup of the application database first, since the new version
  may migrate it (`gcloud sql backups create --project=<project> --instance=metabase-appdb`). Then run **BCC - Build
  and deploy Metabase** with a new version. Cloud Run moves traffic to the new revision once its health check passes.
  For a large upstream upgrade, set `max_instances=1` for the rollout so that old and new versions don't share the
  database, and remove it afterwards.
- **Infrastructure changes**: a push to `master` that changes `infra/` plans sandbox. Apply, and anything in prod,
  by running **BCC - Deploy Terraform** by hand. Terraform leaves the running image alone, so it never rolls back a
  version the build workflow deployed.

## Operate

- **Logs**: Cloud Run → `metabase` → Logs in the environment's project. Gateway request logs are on the
  `bs-metabase-app-<environment>` backend service.
- **Backups**: daily, kept for 14 days, with point-in-time recovery for the last 7 days. To restore, clone the
  instance to a point in time (Cloud SQL → `metabase-appdb` → Clone) and point Metabase at the clone.
- **Scaling**: raise `cpu`, `memory` or `max_instances`, or `db_tier` when the database is the bottleneck. Several
  instances are fine: they share the application database, which coordinates their scheduled work.
- **Never change `MB_ENCRYPTION_SECRET_KEY`**: Metabase encrypts database credentials and secrets in the
  application database with it and can't read them with another key. Terraform generates it once and keeps it in
  the state and in Secret Manager.

## Security notes

- The application database has no public IP address, accepts TLS connections only and is reachable from the VPC
  alone.
- Cloud Run accepts requests from the gateway only (`internal-and-cloud-load-balancing`); its `run.app` address is
  closed. People sign in to Metabase itself, so Cloud Run doesn't require a Google identity.
- Metabase runs as a dedicated service account that can read its two secrets and nothing else.
- Cloud Armor rate-limits each client IP. Its SQL injection and XSS rules are left off on purpose: Metabase's own
  requests carry SQL and HTML.
- Anonymous usage statistics to Metabase and update checks are turned off.

## Not covered here

- **BCC Monitoring.** Logs land in the project's Cloud Logging as usual. Sending traces to the
  [BCC Monitoring](https://developer.bcc.no/bcc-monitoring/) collector would need Metabase's tracing to send the
  collector's `Authorization` header, which it can't yet.
- **Private connections to BCC's databases** on premises or in another cloud: add HA VPN or Interconnect to the
  VPC.
- **Email**: set up SMTP in Metabase (Admin → Settings → Email) so subscriptions and alerts can be sent.
