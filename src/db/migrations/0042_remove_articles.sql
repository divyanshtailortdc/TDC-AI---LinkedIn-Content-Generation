-- Removes the long-form Articles feature added by 0040_articles_and_link_posts:
-- the articles table, and the article-link columns on post_drafts. Their data
-- is dropped. Idempotent, and safe on a database that never ran 0040.
ALTER TABLE "post_drafts" DROP CONSTRAINT IF EXISTS "post_drafts_article_id_articles_id_fk";--> statement-breakpoint
DROP TABLE IF EXISTS "articles" CASCADE;--> statement-breakpoint
ALTER TABLE "post_drafts" DROP COLUMN IF EXISTS "article_id";--> statement-breakpoint
ALTER TABLE "post_drafts" DROP COLUMN IF EXISTS "link_url";--> statement-breakpoint
ALTER TABLE "post_drafts" DROP COLUMN IF EXISTS "link_title";--> statement-breakpoint
ALTER TABLE "post_drafts" DROP COLUMN IF EXISTS "link_description";
