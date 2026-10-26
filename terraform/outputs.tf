output "app_url" {
  description = "Open the app here; also the NEXT_PUBLIC_APP_URL build arg and the OAuth redirect base."
  value       = local.app_url
}

output "image_repository" {
  description = "Push the app image here, as <repository>/app:<tag>."
  value       = local.repository
}

output "db_connection_name" {
  value = google_sql_database_instance.main.connection_name
}

output "media_bucket" {
  description = "Private bucket for post images (STORAGE_BUCKET)."
  value       = google_storage_bucket.media.name
}

output "worker_service" {
  description = "The Cloud Run service that runs the job worker and the scheduler, when separate_worker is set; its logs show research runs."
  value       = one(google_cloud_run_v2_service.worker[*].name)
}

output "migrate_command" {
  value = "gcloud run jobs execute ${google_cloud_run_v2_job.migrate.name} --region ${var.region} --wait"
}
