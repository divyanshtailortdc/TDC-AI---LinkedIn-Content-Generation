ALTER TABLE "schedules" ADD COLUMN "timezone" varchar(64);--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "goal_ids" jsonb;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "last_error" text;