# Deploying to Google Cloud

Terraform here creates everything the app needs in one Google Cloud project:

| Resource | What it's for |
|---|---|
| Artifact Registry repo | Holds the app's Docker image |
| Cloud SQL (Postgres 16) | The app's database; pgvector is built in |
| Secret Manager secrets | DB password, Better Auth secret, API keys, OAuth credentials |
| Cloud Run service | Runs the app; also the job worker and the cron scheduler, unless `separate_worker` is set |
| Cloud Run worker service | Only with `separate_worker = true`: the job worker and the cron scheduler |
| Cloud Run job | Runs `pnpm db:migrate` against Cloud SQL |
| Service account | The identity the service and job run as |

The service runs **exactly one always-on instance**. By default the worker
and the scheduler live inside the server process (`src/instrumentation.ts`),
so scaling to zero would stop them.

With `separate_worker = true`, they move to a second service built from the
same image (`APP_ROLE=worker`): one always-on instance that accepts no
traffic. The app service then only serves pages and queues runs
(`APP_ROLE=web`), and the worker picks runs up within a few seconds. Research
runs no longer hold up page requests, for about $55 a month more. Drafting and
image generation stay in the app service either way, inside the request that
asks for them. Turn it on only if the event-loop delay log shows research runs
are the problem (see "Checking page latency during runs").

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) 1.5 or newer
- [gcloud CLI](https://cloud.google.com/sdk/docs/install), signed in:
  ```bash
  gcloud auth login
  gcloud auth application-default login   # credentials Terraform uses
  gcloud config set project <project-id>
  ```
- A Google Cloud project with billing enabled, and Owner (or Editor plus
  Security Admin) on it
- Docker

## Testing without a Google Cloud account

`tests/plan.tftest.hcl` runs the config against mock Google providers:
nothing is created and no credentials are needed.

```bash
terraform init -backend=false
terraform validate
terraform test
```

It checks the app URL, the placeholder-then-real image switch, which secrets
get created, the single always-on instance, and the Cloud SQL socket path.

## First deploy

Run everything from this `terraform/` folder unless a step says otherwise.

**1. Fill in the variables.**

```bash
cp terraform.tfvars.example terraform.tfvars
```

Set `project_id` and your API keys and OAuth credentials. Leave `image_tag`
commented out for now. `terraform.tfvars` is git-ignored and kept out of the
Docker image.

**2. Create the infrastructure.**

```bash
terraform init
terraform apply
```

This takes about 10–15 minutes, most of it Cloud SQL. With no image pushed
yet, Cloud Run runs Google's public placeholder image.

**3. Build the app image and push it.**

`NEXT_PUBLIC_APP_URL` is compiled into the browser bundle, so build with
the URL from Terraform:

```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev   # your region

REPO=$(terraform output -raw image_repository)
APP_URL=$(terraform output -raw app_url)

cd ..
docker build -t "$REPO/app:v1" --build-arg NEXT_PUBLIC_APP_URL="$APP_URL" .
docker push "$REPO/app:v1"
cd terraform
```

**4. Deploy the image.** In `terraform.tfvars`, set `image_tag = "v1"`, then:

```bash
terraform apply
```

**5. Create the tables.**

```bash
$(terraform output -raw migrate_command)
```

The command waits and should end with the execution completing. If it
fails, the logs are in Cloud Console → Cloud Run → Jobs →
tdc-linkedin-migrate. Until it has run, the app's worker logs
`relation "runs" does not exist`.

**6. Allow the OAuth redirects.** In the Google Cloud console (OAuth client)
and the LinkedIn developer portal, add:

```
<app_url>/api/auth/callback/google
<app_url>/api/auth/callback/linkedin
```

`terraform output app_url` prints the base URL. Then open it and sign in.

## Deploying a new version

```bash
REPO=$(terraform output -raw image_repository)
APP_URL=$(terraform output -raw app_url)

cd ..
docker build -t "$REPO/app:v2" --build-arg NEXT_PUBLIC_APP_URL="$APP_URL" .
docker push "$REPO/app:v2"
cd terraform
# set image_tag = "v2" in terraform.tfvars
terraform apply
$(terraform output -raw migrate_command)    # only when there are new migrations
```

Use a new tag for every build. If you push over an existing tag, Terraform
sees no change and Cloud Run keeps the old image.

## Changing a secret

Edit it in `terraform.tfvars` and run `terraform apply`. Cloud Run reads
secrets when an instance starts, so redeploy to pick it up:

```bash
gcloud run services update tdc-linkedin --region asia-south1 \
  --update-labels=restarted=$(date +%s)
```

With `separate_worker` set, run it for `tdc-linkedin-worker` too.

## Sharing state

Terraform keeps track of what it created in `terraform.tfstate`. That file
contains the database password and every secret, and anyone else who runs
Terraform needs the same copy. Keep it in a private bucket:

```bash
gcloud storage buckets create gs://<project-id>-tfstate \
  --location asia-south1 --uniform-bucket-level-access
gcloud storage buckets update gs://<project-id>-tfstate --versioning
```

Uncomment the `backend "gcs"` block in `versions.tf`, set the bucket name,
and run `terraform init -migrate-state`. Then delete the local
`terraform.tfstate*` files.

## Custom domain

Map the domain to the service (Cloud Run → Manage custom domains), set
`app_url = "https://linkedin.example.com"` in `terraform.tfvars`, rebuild the
image with that URL, apply, and update the OAuth redirect URLs.

## Checking page latency during runs

Each instance logs its event-loop delay once a minute
(`src/lib/event-loop-delay.ts`): how long a request had to wait for work
already holding the thread. In Logs Explorer:

```
resource.type="cloud_run_revision"
jsonPayload.message="Event loop delay"
```

An idle loop reads 0 ms. Request latency is in the request logs
(`log_id("run.googleapis.com/requests")`, `httpRequest.latency`). To find
what slows pages, compare three periods of a few minutes each:

1. Quiet: no run, no drafting, no image generation.
2. A research run in progress, and nothing else: start one, then use the
   app without drafting or generating images.
3. Drafting a post or generating an image.

Then decide:

- **p99 high in period 2:** set `separate_worker = true`. The research run
  moves out of the app's process.
- **p99 high only in period 3:** that work runs inside the request, so the
  worker service would not help. It needs to move off the main thread.
- **Low throughout:** nothing to do.

With `separate_worker` set, `jsonPayload.role` tells the services apart:
`web` and `worker`, instead of `all` for the single service.

## Costs and teardown

The two ongoing costs are one always-on Cloud Run instance (1 vCPU, 2 GiB,
billed for every second it runs) and a `db-g1-small` Cloud SQL instance with
backups; together roughly $80–110 a month, plus AI and API usage.
`separate_worker = true` adds a second such instance, about $55 a month. With
it on, you can set `cpu_idle = true` on the app service in `main.tf`, so it
is billed only while serving requests. Do this after you have measured: the
throttled idle loop makes the event-loop delay log read high. Check the
[pricing calculator](https://cloud.google.com/products/calculator) for your
region before deploying.

To remove everything, set `deletion_protection = false` on
`google_sql_database_instance.main` in `main.tf`, run `terraform apply`, then
`terraform destroy`. Deleting the database deletes its data and backups.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Error 403: ... API has not been used` on the first apply | The API was just enabled; run `terraform apply` again after a minute. |
| `allUsers` IAM error (`FAILED_PRECONDITION` / domain restricted sharing) | Your organisation blocks public services. Ask an org admin to allow it for this project. |
| App shows Google's "It's running!" page | `image_tag` isn't set yet (step 4). |
| Only the passkey button on the login page | `google_*` / `linkedin_*` values are empty in `terraform.tfvars`. |
| `redirect_uri_mismatch` on sign-in | Step 6: add the callback URL in the provider console. |
| Container fails to start | Cloud Console → Cloud Run → tdc-linkedin (or tdc-linkedin-worker) → Logs. |
| Runs stay "queued" | The worker isn't running: check the logs of tdc-linkedin, or of tdc-linkedin-worker with `separate_worker` set. |
