data "google_project" "this" {}

locals {
  # Cloud Run gives every service a fixed URL, so it is known before the
  # service exists (the app needs it for BETTER_AUTH_URL).
  app_url = coalesce(
    var.app_url,
    "https://${var.service_name}-${data.google_project.this.number}.${var.region}.run.app"
  )

  repository = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
  image = (
    var.image_tag == null
    ? "us-docker.pkg.dev/cloudrun/container/hello"
    : "${local.repository}/app:${var.image_tag}"
  )

  db_name = "tdc_linkedin_engine"
  db_user = "app"

  # postgres.js reads the Cloud SQL socket from PGHOST when the URL has no
  # host; a `?host=` query parameter is ignored.
  db_env = {
    DATABASE_URL = "postgresql:///${local.db_name}"
    PGHOST       = "/cloudsql/${google_sql_database_instance.main.connection_name}"
    PGUSER       = local.db_user
  }

  plain_env = merge(local.db_env, {
    APP_ENV             = "production"
    BETTER_AUTH_URL     = local.app_url
    NEXT_PUBLIC_APP_URL = local.app_url
    RESEARCH_MODE       = var.research_mode
    ADMIN_USER_IDS      = var.admin_user_ids
    # Post images through the S3-compatible API, the same code path as any
    # other host (src/lib/media/image-store.ts).
    STORAGE_BUCKET        = google_storage_bucket.media.name
    STORAGE_ENDPOINT      = "https://storage.googleapis.com"
    STORAGE_REGION        = "auto"
    STORAGE_ACCESS_KEY_ID = google_storage_hmac_key.app.access_id
  })

  # Your keys from terraform.tfvars; only the ones you set become secrets.
  optional_secrets = {
    AI_GATEWAY_API_KEY     = var.ai_gateway_api_key
    ANTHROPIC_API_KEY      = var.anthropic_api_key
    SERPER_API_KEY         = var.serper_api_key
    GOOGLE_CLIENT_ID       = var.google_client_id
    GOOGLE_CLIENT_SECRET   = var.google_client_secret
    LINKEDIN_CLIENT_ID     = var.linkedin_client_id
    LINKEDIN_CLIENT_SECRET = var.linkedin_client_secret
  }
  secret_values = merge(local.optional_secrets, {
    PGPASSWORD                = random_password.db.result
    BETTER_AUTH_SECRET        = random_password.auth.result
    STORAGE_SECRET_ACCESS_KEY = google_storage_hmac_key.app.secret
  })
  # Decided from your variables alone: the generated passwords aren't known
  # until apply, and for_each needs the set of names at plan time. Only
  # whether a key is set is revealed here, never its value.
  secret_names = toset(concat(
    ["PGPASSWORD", "BETTER_AUTH_SECRET", "STORAGE_SECRET_ACCESS_KEY"],
    [for name, value in local.optional_secrets : name if nonsensitive(value != "")]
  ))
}

# --- APIs ---------------------------------------------------------------

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# --- Image registry -----------------------------------------------------

resource "google_artifact_registry_repository" "app" {
  repository_id = var.service_name
  location      = var.region
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

# --- Database -----------------------------------------------------------

resource "google_sql_database_instance" "main" {
  name             = "${var.service_name}-db"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    # Postgres 16 defaults to Enterprise Plus, which has no small tiers.
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_autoresize   = true

    # A public IP with no authorised networks: only Cloud SQL connectors,
    # which authenticate with IAM, can reach it.
    ip_configuration {
      ipv4_enabled = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }

  # Terraform refuses to delete the database; set to false first on purpose.
  deletion_protection = true

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  name     = local.db_name
  instance = google_sql_database_instance.main.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "auth" {
  length  = 48
  special = false
}

# Users created through the API are in cloudsqlsuperuser, which may create
# the pgvector extension (migration 0003).
resource "google_sql_user" "app" {
  name     = local.db_user
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

# --- Post images --------------------------------------------------------

# Generated post images (src/lib/media/image-store.ts); the database keeps only
# their storage:// keys. Private: the app hands the browser signed links.
resource "google_storage_bucket" "media" {
  name                        = "${var.project_id}-${var.service_name}-media"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Download and copy on the review screen read the image with fetch().
  cors {
    origin          = [local.app_url]
    method          = ["GET"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.apis]
}

# --- Secrets ------------------------------------------------------------

resource "google_secret_manager_secret" "app" {
  for_each  = local.secret_names
  secret_id = "${var.service_name}-${lower(replace(each.key, "_", "-"))}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = local.secret_names
  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = local.secret_values[each.key]
}

# --- Runtime identity ---------------------------------------------------

resource "google_service_account" "app" {
  account_id   = "${var.service_name}-run"
  display_name = "TDC LinkedIn app (Cloud Run)"
}

resource "google_project_iam_member" "app_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "app" {
  for_each  = local.secret_names
  secret_id = google_secret_manager_secret.app[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# Read, write and delete post images; no say over the bucket itself.
resource "google_storage_bucket_iam_member" "app_media" {
  bucket = google_storage_bucket.media.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.app.email}"
}

# The app's key for the bucket's S3-compatible API, which signs image links
# too. The secret lands in Terraform state, like the database password.
resource "google_storage_hmac_key" "app" {
  service_account_email = google_service_account.app.email
}

# --- App ----------------------------------------------------------------

resource "google_cloud_run_v2_service" "app" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.app.email

    # The job worker and cron scheduler run inside the server process
    # (src/instrumentation.ts): exactly one instance, always on, so runs are
    # picked up and schedules fire once.
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }

    containers {
      image = local.image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "2Gi"
        }
        # Keep CPU between requests so the worker keeps running.
        cpu_idle          = false
        startup_cpu_boost = true
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.plain_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secret_names
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.app_sql_client,
    google_secret_manager_secret_iam_member.app,
    google_secret_manager_secret_version.app,
    google_storage_bucket_iam_member.app_media,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Migrations ---------------------------------------------------------

# Runs `pnpm db:migrate` with the app image. Execute it after each deploy
# that adds a migration (README.md, step 6).
resource "google_cloud_run_v2_job" "migrate" {
  name                = "${var.service_name}-migrate"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.app.email
      max_retries     = 0
      timeout         = "600s"

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        image   = local.image
        command = ["pnpm"]
        args    = ["db:migrate"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        dynamic "env" {
          for_each = local.db_env
          content {
            name  = env.key
            value = env.value
          }
        }

        env {
          name = "PGPASSWORD"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["PGPASSWORD"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.app_sql_client,
    google_secret_manager_secret_iam_member.app,
    google_secret_manager_secret_version.app,
  ]
}
