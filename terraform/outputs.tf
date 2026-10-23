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

output "migrate_command" {
  value = "gcloud run jobs execute ${google_cloud_run_v2_job.migrate.name} --region ${var.region} --wait"
}
