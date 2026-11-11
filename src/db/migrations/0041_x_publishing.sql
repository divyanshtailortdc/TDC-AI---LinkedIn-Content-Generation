-- Publishing to X (through Buffer) beside LinkedIn: a user has one connection
-- per platform, and each publication records the platform it goes to. Every
-- existing row is LinkedIn's (the default). Written to run whether or not a
-- database already has these columns: earlier builds of this change ran as
-- 0039_x_publishing or 0040_x_publishing on some development databases.
ALTER TABLE "linkedin_connections" DROP CONSTRAINT IF EXISTS "linkedin_connections_user_id_unique";--> statement-breakpoint
ALTER TABLE "linkedin_connections" ADD COLUMN IF NOT EXISTS "platform" varchar(30) DEFAULT 'linkedin' NOT NULL;--> statement-breakpoint
ALTER TABLE "linkedin_publications" ADD COLUMN IF NOT EXISTS "platform" varchar(30) DEFAULT 'linkedin' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_connections" ADD CONSTRAINT "linkedin_connections_user_platform_unique" UNIQUE("user_id","platform");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
