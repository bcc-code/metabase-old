variable "project_id" {
  description = "Google Cloud project to host Metabase in. A project of its own is recommended."
  type        = string
}

variable "region" {
  description = "Region for every regional resource. europe-north1 (Finland) is the closest region to Norway with every service used here, and keeps all data in the EU/EEA."
  type        = string
  default     = "europe-north1"
}

variable "name" {
  description = "Prefix for resource names."
  type        = string
  default     = "metabase"
}

variable "domain" {
  description = "Public host name Metabase is served at, such as metabase.bcc.no. Point an A record for it at the `load_balancer_ip` output."
  type        = string
}

variable "image" {
  description = "The BCC Metabase container image, such as europe-north1-docker.pkg.dev/PROJECT/metabase/metabase:v0.66.0-bcc.1 (see README.md for building it)."
  type        = string
}

variable "timezone" {
  description = "Timezone Metabase's JVM runs in, which reports use unless a report timezone is set in Metabase."
  type        = string
  default     = "Europe/Oslo"
}

variable "cpu" {
  description = "vCPUs per Metabase instance."
  type        = string
  default     = "2"
}

variable "memory" {
  description = "Memory per Metabase instance. Metabase needs at least 2Gi; 4Gi leaves room for large results and exports."
  type        = string
  default     = "4Gi"
}

variable "min_instances" {
  description = "Instances kept running at all times. At least 1: Metabase runs alerts, subscriptions, database sync and cache refreshing in the background."
  type        = number
  default     = 1

  validation {
    condition     = var.min_instances >= 1
    error_message = "Keep at least one instance running, or scheduled work (alerts, subscriptions, sync, cache refreshing) stops."
  }
}

variable "max_instances" {
  description = "Instances Cloud Run may scale out to under load. They share the application database, which coordinates scheduled work between them."
  type        = number
  default     = 3
}

variable "db_tier" {
  description = "Cloud SQL machine type of the application database."
  type        = string
  default     = "db-custom-2-7680"
}

variable "db_disk_size_gb" {
  description = "Initial disk size of the application database, in GB. It grows automatically."
  type        = number
  default     = 20
}

variable "db_high_availability" {
  description = "Run the application database with a standby in a second zone (Cloud SQL regional availability). Doubles the database cost; recommended once Metabase is business critical."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Refuse to delete the application database, from Terraform and from the console."
  type        = bool
  default     = true
}

variable "subnet_cidr" {
  description = "Range of the subnet Metabase's outbound traffic leaves through. Must not overlap networks you peer with or connect to."
  type        = string
  default     = "10.10.0.0/24"
}

variable "rate_limit_per_minute" {
  description = "Requests per minute one IP address may make before Cloud Armor answers 429. Opening a dashboard makes a few dozen requests."
  type        = number
  default     = 3000
}

variable "alert_email" {
  description = "Email address to alert when Metabase's health check fails. Empty for no alerts."
  type        = string
  default     = ""
}

variable "extra_env" {
  description = "Further environment variables for Metabase, such as MB_APPLICATION_FONT. Don't put secrets here: they end up in the service definition in clear text."
  type        = map(string)
  default     = {}
}
