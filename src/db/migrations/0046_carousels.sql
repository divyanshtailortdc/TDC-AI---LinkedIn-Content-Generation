-- Carousel posts: each slide's text, design and drawn image (post_slides),
-- and what goes out with a post's text (post_drafts.media_format: 'text',
-- 'image' or 'carousel'; null on every existing post, which keeps following
-- its image). Idempotent.
CREATE TABLE IF NOT EXISTS "post_slides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" varchar(10) NOT NULL,
	"headline" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"image_prompt" text DEFAULT '' NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"alt_text" text,
	"image_url" text,
	"picture_url" text,
	"render_status" varchar(10) DEFAULT 'ready' NOT NULL,
	"render_error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "media_format" varchar(20);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "post_slides" ADD CONSTRAINT "post_slides_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_slides_draft_position_idx" ON "post_slides" USING btree ("draft_id","position");
