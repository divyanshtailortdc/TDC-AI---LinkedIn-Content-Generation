mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789" }
  }
  mock_resource "google_sql_database_instance" {
    defaults = { connection_name = "test-project:asia-south1:tdc-linkedin-db" }
  }
}
mock_provider "random" {}

variables {
  project_id           = "test-project"
  google_client_id     = "id"
  google_client_secret = "secret"
}

run "first_apply_runs_placeholder" {
  command = apply

  assert {
    condition     = output.app_url == "https://tdc-linkedin-123456789.asia-south1.run.app"
    error_message = "app_url is ${output.app_url}"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].containers[0].image == "us-docker.pkg.dev/cloudrun/container/hello"
    error_message = "placeholder image not used without image_tag"
  }
  assert {
    condition     = contains(keys(google_secret_manager_secret.app), "GOOGLE_CLIENT_ID") && !contains(keys(google_secret_manager_secret.app), "LINKEDIN_CLIENT_ID")
    error_message = "secrets should exist only for values that are set"
  }
  assert {
    condition     = contains(keys(google_secret_manager_secret.app), "PGPASSWORD") && contains(keys(google_secret_manager_secret.app), "BETTER_AUTH_SECRET")
    error_message = "generated secrets missing"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].scaling[0].min_instance_count == 1 && google_cloud_run_v2_service.app.template[0].scaling[0].max_instance_count == 1
    error_message = "service must run exactly one instance"
  }
  assert {
    condition     = one([for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.value if e.name == "PGHOST"]) == "/cloudsql/test-project:asia-south1:tdc-linkedin-db"
    error_message = "PGHOST does not point at the Cloud SQL socket"
  }
}

run "image_tag_deploys_app_image" {
  command = apply
  variables {
    image_tag = "v1"
  }

  assert {
    condition     = google_cloud_run_v2_service.app.template[0].containers[0].image == "asia-south1-docker.pkg.dev/test-project/tdc-linkedin/app:v1"
    error_message = "image is ${google_cloud_run_v2_service.app.template[0].containers[0].image}"
  }
  assert {
    condition     = google_cloud_run_v2_job.migrate.template[0].template[0].containers[0].image == google_cloud_run_v2_service.app.template[0].containers[0].image
    error_message = "migrate job must use the app image"
  }
}
