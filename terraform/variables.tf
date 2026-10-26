variable "project_id" {
  description = "The Google Cloud project to deploy into."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Cloud SQL and Artifact Registry."
  type        = string
  default     = "asia-south1"
}

variable "service_name" {
  description = "Name of the Cloud Run service; also prefixes the other resources."
  type        = string
  default     = "tdc-linkedin"
}

variable "image_tag" {
  description = "Tag of the app image in Artifact Registry. Leave null on the first apply, before any image is pushed: a public placeholder runs instead."
  type        = string
  default     = null
}

variable "app_url" {
  description = "The URL people open the app at. Defaults to the service's run.app URL; set it when you map a custom domain."
  type        = string
  default     = null
}

variable "db_tier" {
  description = "Cloud SQL machine tier (Enterprise edition)."
  type        = string
  default     = "db-g1-small"
}

variable "admin_user_ids" {
  description = "Comma-separated user IDs given the admin role."
  type        = string
  default     = ""
}

variable "separate_worker" {
  description = "Run the job worker and scheduler in a Cloud Run service of their own (about $55 a month more) instead of inside the app's. Turn on if the event-loop delay log shows research runs slowing pages (README.md, \"Checking page latency during runs\")."
  type        = bool
  default     = false
}

variable "research_mode" {
  description = "How runs research the web: 'fixed' or 'agent'."
  type        = string
  default     = "fixed"
}

# Secrets. Each one that is set is stored in Secret Manager and passed to the
# app; leave the ones you don't use empty.

variable "ai_gateway_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "anthropic_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "serper_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "google_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "linkedin_client_id" {
  type      = string
  default   = ""
  sensitive = true
}

variable "linkedin_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}
