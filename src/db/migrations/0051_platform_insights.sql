-- What each identity's public profile on a platform shows about how it posts
-- there (src/lib/profile-insights): one row per identity and platform, made
-- from the profile link saved in accounts.profile_links. Idempotent.
CREATE TABLE IF NOT EXISTS "platform_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" varchar(30) NOT NULL,
	"profile_url" text NOT NULL,
	"status" varchar(20) DEFAULT 'analyzing' NOT NULL,
	"insights" jsonb,
	"posts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"analyzed_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_insights_account_platform_unique" UNIQUE("account_id","platform"),
	CONSTRAINT "platform_insights_status_check" CHECK ("platform_insights"."status" in ('analyzing', 'ready', 'unavailable', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "platform_insights" ADD CONSTRAINT "platform_insights_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
