-- Where a published blog or article went out: a website or CMS
-- (src/lib/blogs/destinations.ts), never a social platform. Null for drafts
-- and for blogs marked published before the app asked where; those rows are
-- left as they are. Additive and idempotent.
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "published_to" varchar(20);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blogs" ADD CONSTRAINT "blogs_published_to_check" CHECK ("blogs"."published_to" is null or "blogs"."published_to" in ('website', 'wordpress', 'webflow', 'shopify', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
