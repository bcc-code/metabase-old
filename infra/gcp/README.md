# Hosting BCC Metabase on Google Cloud

This directory holds the Terraform configuration that runs the BCC Metabase fork on Google Cloud, and this document
explains how it fits together and how to deploy and run it. For the fork's features and their settings, see
[`FORK.md`](../../FORK.md).

## Architecture

```
                 people, public links, embeds
                              │ HTTPS (metabase.bcc.no)
                              ▼
        ┌──────────────────────────────────────────────┐
        │ Global external Application Load Balancer    │  static IP, Google-managed TLS certificate,
        │  + Cloud Armor                               │  HTTP→HTTPS redirect, rate limiting per IP
        └──────────────────────┬───────────────────────┘
                               │ (Cloud Run accepts traffic from the load balancer only)
                               ▼
        ┌──────────────────────────────────────────────┐
        │ Cloud Run service "metabase"                 │  BCC Metabase image from Artifact Registry,
        │  1–3 instances, 2 vCPU / 4 GiB each,         │  secrets from Secret Manager
        │  CPU always allocated                        │
        └──────────────────────┬───────────────────────┘
                               │ all outbound traffic (Direct VPC egress)
                               ▼
        ┌──────────────────────── VPC "metabase-vpc" ──────────────────────────┐
        │                                                                      │
        │   Cloud SQL for PostgreSQL 16          Cloud NAT, one static IP ─────┼──► BCC's databases,
        │   (application database,               ("egress_ip" output)          │    login.bcc.no, SMTP
        │    private IP only, TLS only,                                        │
        │    daily backups + point-in-time recovery)                           │
        └──────────────────────────────────────────────────────────────────────┘
```

| Piece | Choice | Why |
|---|---|---|
| Compute | **Cloud Run**, CPU always allocated, at least 1 instance | No servers or cluster to maintain, rolling deploys, scales out under load. Metabase runs alerts, dashboard subscriptions, database sync and automatic cache refreshing in the background, which only work when instances keep their CPU between requests and one is always running. |
| Application database | **Cloud SQL for PostgreSQL 16**, private IP, `db-custom-2-7680` | The database Metabase recommends for production. Holds Metabase's own data: users, questions, dashboards, permissions, settings and cached query results. |
| Entry point | **Global external Application Load Balancer** with a managed certificate and **Cloud Armor** | One static IP address for the `metabase.bcc.no` record, TLS 1.2+, HTTP→HTTPS redirect, per-IP rate limiting, request logs. |
| Outbound traffic | **Direct VPC egress** and **Cloud NAT** with a static IP | Metabase reaches the application database privately, and connects to BCC's databases from one known address that their firewalls can allow. |
| Secrets | **Secret Manager** | The database password and `MB_ENCRYPTION_SECRET_KEY` never appear in the service definition. |
| Images | **Artifact Registry**, built with **Cloud Build** | Images stay in the same region; old ones are cleaned up automatically. |
| Monitoring | **Cloud Monitoring** uptime check on `/api/health`, optional email alert | Know when Metabase is down. |

Everything sits in one region, `europe-north1` (Hamina, Finland) by default: the closest region to Norway with all of
these services, and all data stays in the EU/EEA.

Not used, on purpose:

- **Identity-Aware Proxy**: people sign in to Metabase itself through login.bcc.no (OpenID Connect), and public links
  and embeds must work without a Google account.
- **Cloud Armor WAF rules** (SQL injection, XSS): Metabase's own requests carry SQL (native questions) and HTML (text
  cards), which those rules would block.
- **GKE or Compute Engine**: more to run and patch, and nothing Metabase needs that Cloud Run lacks.

## What it costs, roughly

Approximate list prices for the defaults, before any committed-use discounts. Check the
[pricing calculator](https://cloud.google.com/products/calculator) for exact numbers.

| Item | Per month |
|---|---|
| Cloud Run, 1 instance of 2 vCPU / 4 GiB always on | ≈ USD 100–130 |
| Cloud SQL, 2 vCPU / 7.5 GB, zonal, 20 GB SSD and backups | ≈ USD 100–130 (about double with `db_high_availability = true`) |
| Load balancer and Cloud Armor | ≈ USD 25 plus traffic |
| Cloud NAT, Artifact Registry, Secret Manager, logging, monitoring | a few dollars |

## Before you start

- A Google Cloud project for Metabase with billing on (a project of its own keeps permissions and costs separate).
- You have Owner on it, or enough roles to create everything above.
- `gcloud` and Terraform 1.6 or newer installed, and `gcloud auth application-default login` run.
- Access to the `bcc.no` DNS zone, to add the `metabase.bcc.no` record.

## Deploy

All commands run from the repository root unless noted.

1. **Create a bucket for the Terraform state.** The state holds the generated database password and encryption key,
   so only the people who run Terraform may read it.

   ```bash
   gcloud storage buckets create gs://bcc-metabase-terraform-state --project=PROJECT_ID --location=europe-north1 --uniform-bucket-level-access --public-access-prevention
   ```

   ```bash
   gcloud storage buckets update gs://bcc-metabase-terraform-state --versioning
   ```

   Then uncomment the `backend "gcs"` block in `versions.tf`.

2. **Fill in the variables.** Copy `terraform.tfvars.example` to `terraform.tfvars` in this directory and set
   `project_id`, `domain` and `image` (the tag you are about to build). See `variables.tf` for the rest.

3. **Create the image repository first**, so there is somewhere to push the image to:

   ```bash
   cd infra/gcp && terraform init && terraform apply -target=google_artifact_registry_repository.metabase
   ```

4. **Build and push the image** with Cloud Build. The build compiles the frontend and the backend and takes about
   30–45 minutes. Use the same tag as in `image`:

   ```bash
   gcloud builds submit --project=PROJECT_ID --config=infra/gcp/cloudbuild.yaml --substitutions=_VERSION=v0.66.0-bcc.1 .
   ```

5. **Create everything else:**

   ```bash
   cd infra/gcp && terraform apply
   ```

   The first start of Metabase creates its tables in the application database, which takes a few minutes.

6. **Point DNS at the load balancer.** Add an `A` record for the domain with the `load_balancer_ip` output. Google
   issues the certificate once the record resolves, which can take up to about an hour. Check progress with:

   ```bash
   gcloud compute ssl-certificates describe metabase-cert --project=PROJECT_ID --global --format="value(managed.status)"
   ```

7. **Set up Metabase.** Open `https://metabase.bcc.no` and create the first admin account. Then follow
   [`FORK.md`](../../FORK.md): connect login.bcc.no (OpenID Connect), apply the BCC theme and lock down the "All
   Users" group. Give the `egress_ip` output to whoever runs the databases Metabase should read, so that they can
   allow it.

## Upgrade

1. Take an on-demand backup of the application database: the new version may migrate it.

   ```bash
   gcloud sql backups create --project=PROJECT_ID --instance=metabase-appdb
   ```

2. Build the new image under a new tag (step 4 above), set `image` to it and run `terraform apply`. Cloud Run starts
   the new revision, which migrates the database, and moves traffic to it once its health check passes.

For a large upstream upgrade, set `max_instances = 1` for the rollout so that old and new versions don't run against
the database at the same time, and raise it again afterwards.

## Operate

- **Logs**: Cloud Run → `metabase` → Logs, or Logs Explorer with `resource.type="cloud_run_revision"`. Load
  balancer request logs are under `resource.type="http_load_balancer"`.
- **Backups**: daily, kept for 14 days, with point-in-time recovery for the last 7 days. To restore, clone the
  instance to a point in time (Cloud SQL → `metabase-appdb` → Clone), then point Metabase at the clone.
- **Scaling**: raise `cpu`, `memory` or `max_instances` for more users, and `db_tier` if the application database
  is the bottleneck. Several instances are fine: they share the application database, which coordinates their
  scheduled work.
- **Never change `MB_ENCRYPTION_SECRET_KEY`**: Metabase uses it to encrypt database credentials and secrets in the
  application database, and can't read them with another key. Terraform generates it once and keeps it in the state
  and in Secret Manager.
- **Alerts**: set `alert_email` to be emailed when the health check fails for 5 minutes.

## Security notes

- The application database has no public IP address, accepts TLS connections only and is reachable from the VPC
  alone.
- Cloud Run accepts requests from the load balancer only; its `run.app` address is closed.
- Metabase runs as a dedicated service account that can read its two secrets and nothing else.
- The Terraform state contains the database password and encryption key: keep the state bucket private.
- Anonymous usage statistics to Metabase and update checks are turned off.

## Not covered here

- **Continuous deployment**: build and deploy from GitHub Actions with Workload Identity Federation, instead of by
  hand.
- **Private connections to BCC's databases**: if they are on premises or in another cloud without public access, add
  HA VPN or Interconnect to the VPC.
- **Email**: set up SMTP in Metabase (Admin → Settings → Email) so subscriptions and alerts can be sent.
