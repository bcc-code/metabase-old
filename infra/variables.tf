# Filled in by the Infra Platform's Deploy Terraform workflow.

variable "props" {
  type        = string
  description = "A JSON string containing the properties of the current project."
}

variable "deployment_props" {
  type        = string
  description = "A JSON string containing the properties of the current deployment."
}

# Optional. Set them in the GitHub variable MAIN_TERRAFORM_VARS of an environment, one `name=value` per line.

variable "name" {
  description = "Prefix for resource names, and the app name in the platform gateway's route registry."
  type        = string
  default     = "metabase"
}

variable "hostname" {
  description = "Host name Metabase is served at. Defaults to metabase.bcc.no in prod and metabase.<environment>.bcc.no elsewhere, following the platform's environment naming."
  type        = string
  default     = null
}

variable "image" {
  description = "The image Terraform deploys when it creates the service. Later images are rolled out by the Build and deploy Metabase workflow, which Terraform leaves alone. Defaults to the latest image in the project's registry."
  type        = string
  default     = null
}

variable "timezone" {
  description = "Timezone Metabase's JVM runs in, which reports use unless a report timezone is set in Metabase."
  type        = string
  default     = "Europe/Oslo"
}

variable "cpu" {
  description = "vCPUs per Metabase instance. Defaults to 2 in prod and staging, 1 elsewhere."
  type        = string
  default     = null
}

variable "memory" {
  description = "Memory per Metabase instance. Defaults to 4Gi in prod and staging, 2Gi elsewhere. Metabase needs at least 2Gi."
  type        = string
  default     = null
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
  description = "Instances Cloud Run may scale out to under load. Defaults to 3 in prod and staging, 1 elsewhere."
  type        = number
  default     = null
}

variable "db_tier" {
  description = "Cloud SQL machine type of the application database. Defaults to db-custom-2-7680 in prod and staging, db-custom-1-3840 elsewhere."
  type        = string
  default     = null
}

variable "db_disk_size_gb" {
  description = "Initial disk size of the application database, in GB. It grows automatically."
  type        = number
  default     = 20
}

variable "db_high_availability" {
  description = "Run the application database with a standby in a second zone (Cloud SQL regional availability). Doubles the database cost."
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
  default     = "10.20.0.0/24"
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
