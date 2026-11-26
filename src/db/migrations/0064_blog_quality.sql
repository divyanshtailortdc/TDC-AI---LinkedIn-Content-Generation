-- Blog quality: what a generated blog or article now keeps beside its text.
-- The search intent it was written for (empty for blogs written before),
-- the plan it was written from, its featured image, the last check of its
-- citations, and the internal links it carries or could. Additive and
-- idempotent: it can run again without harm.
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "search_intent" varchar(20) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "plan" jsonb;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "featured_image" jsonb;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "verification" jsonb;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "internal_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "blogs" DROP CONSTRAINT IF EXISTS "blogs_search_intent_check";--> statement-breakpoint
ALTER TABLE "blogs" ADD CONSTRAINT "blogs_search_intent_check" CHECK ("blogs"."search_intent" = '' or "blogs"."search_intent" in ('informational', 'commercial', 'transactional', 'navigational'));
