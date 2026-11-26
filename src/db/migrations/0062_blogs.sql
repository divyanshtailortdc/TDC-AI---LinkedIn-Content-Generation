-- Blogs & articles (src/lib/blogs): long-form, SEO-ready pieces an identity
-- writes for its own website, apart from social posts. `blogs` holds each one
-- (its brief, document, FAQ, SEO fields, sources, checks and generation
-- state) and `blog_revisions` the versions its text replaced. AI spend on
-- them is recorded under a source of its own, 'blogs'
-- (src/lib/ai/spend-sources.ts). Additive and idempotent.
CREATE TABLE IF NOT EXISTS "blogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"idea_id" uuid,
	"goal_id" uuid,
	"kind" varchar(10) DEFAULT 'blog' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"generation_status" varchar(20) DEFAULT 'generating' NOT NULL,
	"generation_stage" varchar(20),
	"generation_error" text,
	"generation_started_at" timestamp with time zone,
	"generated_at" timestamp with time zone,
	"brief" jsonb NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"meta_title" text DEFAULT '' NOT NULL,
	"meta_description" text DEFAULT '' NOT NULL,
	"primary_keyword" text DEFAULT '' NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"self_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model" varchar(100),
	"lock_version" integer DEFAULT 1 NOT NULL,
	"published_url" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blogs_kind_check" CHECK ("blogs"."kind" in ('blog', 'article')),
	CONSTRAINT "blogs_status_check" CHECK ("blogs"."status" in ('draft', 'published')),
	CONSTRAINT "blogs_generation_status_check" CHECK ("blogs"."generation_status" in ('generating', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blog_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blog_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"replaced_by" varchar(20) NOT NULL,
	"instruction" text,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blogs" ADD CONSTRAINT "blogs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blogs" ADD CONSTRAINT "blogs_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blogs" ADD CONSTRAINT "blogs_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blog_revisions" ADD CONSTRAINT "blog_revisions_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blogs_account_updated_idx" ON "blogs" USING btree ("account_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blog_revisions_blog_number_uq" ON "blog_revisions" USING btree ("blog_id","number");--> statement-breakpoint
ALTER TABLE "ai_usage" DROP CONSTRAINT IF EXISTS "ai_usage_source_check";--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_source_check" CHECK ("ai_usage"."source" in ('runs', 'posts', 'blogs', 'newsletters', 'inbox', 'identity', 'help', 'unscoped'));
