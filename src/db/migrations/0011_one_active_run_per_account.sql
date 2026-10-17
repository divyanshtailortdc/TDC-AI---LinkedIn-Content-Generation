-- At most one run in progress per account. A database that already has
-- several (two tabs launching at once) keeps the oldest of each account's and
-- fails the rest, or the index below could not be created.
UPDATE "runs" SET "status" = 'failed', "error" = 'Another run for this identity was already in progress.', "updated_at" = now()
WHERE "status" IN ('queued', 'running', 'researching', 'ideating')
  AND "id" NOT IN (
    SELECT DISTINCT ON ("account_id") "id" FROM "runs"
    WHERE "status" IN ('queued', 'running', 'researching', 'ideating')
    ORDER BY "account_id", "created_at" ASC
  );--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_account_uq" ON "runs" USING btree ("account_id") WHERE status in ('queued', 'running', 'researching', 'ideating');
