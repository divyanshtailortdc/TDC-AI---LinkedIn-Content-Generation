CREATE TABLE IF NOT EXISTS "post_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(20) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"model_id" varchar(120) NOT NULL,
	"operation" jsonb,
	"prompt" text NOT NULL,
	"direction" text,
	"aspect_ratio" varchar(10) NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"video_url" text,
	"media_type" varchar(40),
	"byte_size" integer,
	"error" text,
	"estimated_cost_usd" numeric(10, 4) NOT NULL,
	"cost_usd" numeric(10, 4),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_videos" ADD CONSTRAINT "post_videos_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_videos_draft_created_idx" ON "post_videos" USING btree ("draft_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_videos_one_running_uq" ON "post_videos" USING btree ("draft_id") WHERE "post_videos"."status" in ('generating', 'finishing');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_videos_draft_version_uq" ON "post_videos" USING btree ("draft_id","version");