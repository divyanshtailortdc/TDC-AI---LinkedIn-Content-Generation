terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State holds the generated DB password and every secret below. Once a
  # second person runs Terraform, keep it in a private GCS bucket instead of
  # on one laptop (see README.md, "Sharing state"):
  #
  # backend "gcs" {
  #   bucket = "<your-project-id>-tfstate"
  #   prefix = "tdc-linkedin"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
