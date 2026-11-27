-- Blog share links: the secret in a blog's public link (/share/<token>),
-- null when it is not shared. Unique, so a link finds one blog. Additive and
-- idempotent: it can run again without harm.
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "share_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "blogs_share_token_uq" ON "blogs" USING btree ("share_token");
