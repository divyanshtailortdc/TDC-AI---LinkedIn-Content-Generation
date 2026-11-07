-- LinkedIn publishing: connections and publications. Written to run whether
-- or not a database already has them: it was first built as
-- 0035_linkedin_publishing, before 0035_idea_goal_fit_and_story_use took 0035,
-- and databases that ran that keep their tables and rows.
CREATE TABLE IF NOT EXISTS "linkedin_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"name" text,
	"picture_url" text,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp with time zone,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"auto_publish_time" varchar(5) DEFAULT '09:00' NOT NULL,
	"auto_publish_timezone" varchar(64),
	"auto_publish_enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linkedin_connections_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "linkedin_connections_status_check" CHECK ("linkedin_connections"."status" in ('connected', 'expired', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "linkedin_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"connection_id" uuid,
	"author_urn" text,
	"trigger" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"locked_at" timestamp with time zone,
	"linkedin_post_urn" text,
	"published_at" timestamp with time zone,
	"error" text,
	"error_code" varchar(40),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linkedin_publications_status_check" CHECK ("linkedin_publications"."status" in ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
	CONSTRAINT "linkedin_publications_trigger_check" CHECK ("linkedin_publications"."trigger" in ('manual', 'scheduled', 'auto'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_connections" ADD CONSTRAINT "linkedin_connections_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_publications" ADD CONSTRAINT "linkedin_publications_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_publications" ADD CONSTRAINT "linkedin_publications_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_publications" ADD CONSTRAINT "linkedin_publications_connection_id_linkedin_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."linkedin_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_connections_auto_publish_idx" ON "linkedin_connections" USING btree ("auto_publish") WHERE "linkedin_connections"."auto_publish";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "linkedin_publications_one_live_per_draft_uq" ON "linkedin_publications" USING btree ("draft_id") WHERE status in ('scheduled', 'publishing', 'published');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_publications_due_idx" ON "linkedin_publications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_publications_user_created_idx" ON "linkedin_publications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_publications_draft_created_idx" ON "linkedin_publications" USING btree ("draft_id","created_at");