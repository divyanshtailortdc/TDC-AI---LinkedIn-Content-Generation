-- One schedule per account. A database that already has several (two saves
-- racing) keeps each account's most recently saved one and deletes the rest,
-- or the constraint below could not be added.
DELETE FROM "schedules"
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("account_id") "id" FROM "schedules"
  ORDER BY "account_id", "updated_at" DESC
);--> statement-breakpoint
CREATE INDEX "audiences_account_idx" ON "audiences" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "feedback_account_verdict_created_idx" ON "feedback" USING btree ("account_id","verdict","created_at");--> statement-breakpoint
CREATE INDEX "offerings_account_idx" ON "offerings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sample_posts_account_idx" ON "sample_posts" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_account_id_unique" UNIQUE("account_id");