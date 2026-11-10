-- Long-form articles written from an idea (one per idea), beside the posts in
-- post_drafts, and article-link posts: a post that shares a web page as a link
-- card (link_url, link_title, link_description). Additive only; existing posts
-- keep every value. Idempotent, so it can be re-run safely.
CREATE TABLE IF NOT EXISTS "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"idea_id" uuid,
	"platform" varchar(30) DEFAULT 'linkedin' NOT NULL,
	"generation_status" varchar(20) DEFAULT 'generating' NOT NULL,
	"generation_error" text,
	"generation_started_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"generation_count" integer DEFAULT 0 NOT NULL,
	"guidance" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"content" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"call_to_action" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"cover_image_url" text,
	"cover_image_alt" text,
	"cover_suggestion" jsonb,
	"promo_post" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lint_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"self_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"original" jsonb,
	"previous_version" jsonb,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" varchar(100),
	"published_url" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_idea_id_unique" UNIQUE("idea_id"),
	CONSTRAINT "articles_generation_status_check" CHECK ("articles"."generation_status" in ('generating', 'ready', 'failed')),
	CONSTRAINT "articles_status_check" CHECK ("articles"."status" in ('draft', 'published'))
);
--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "article_id" uuid;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "link_url" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "link_title" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "link_description" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_account_updated_idx" ON "articles" USING btree ("account_id","updated_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_drafts" ADD CONSTRAINT "post_drafts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;