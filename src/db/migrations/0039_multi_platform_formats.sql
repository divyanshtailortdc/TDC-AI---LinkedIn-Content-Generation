-- Multi-platform formats (src/lib/formats) and post versions (post_revisions).
-- Written to run whether or not a database already has them: it was first
-- built as 0036_multi_platform_formats and 0037_post_revisions, before
-- 0036_linkedin_publishing and 0037_post_hide_and_delete took those numbers,
-- and databases that ran those keep their columns and rows.
CREATE TABLE IF NOT EXISTS "post_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"replaced_by" varchar(20) NOT NULL,
	"instruction" text,
	"hook" text NOT NULL,
	"body" text NOT NULL,
	"cta" text,
	"first_comment" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb,
	"payload" jsonb,
	"char_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "format_id" varchar(40) DEFAULT 'linkedin.post' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "format_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "payload" jsonb;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "source_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "target_formats" jsonb DEFAULT '["linkedin.post"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "format_fit" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "enabled_formats" jsonb DEFAULT '["linkedin.post"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN IF NOT EXISTS "channel_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "channel" varchar(20);--> statement-breakpoint
ALTER TABLE "sample_posts" ADD COLUMN IF NOT EXISTS "platform" varchar(20) DEFAULT 'linkedin' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_revisions" ADD CONSTRAINT "post_revisions_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_revisions_draft_number_uq" ON "post_revisions" USING btree ("draft_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_drafts_idea_format_uq" ON "post_drafts" USING btree ("idea_id","format_id") WHERE "post_drafts"."idea_id" is not null and "post_drafts"."format_id" <> 'linkedin.post';