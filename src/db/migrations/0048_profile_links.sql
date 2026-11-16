-- A profile link per platform (src/lib/profile-links.ts). linkedin_url keeps
-- the main one. Links saved before this are read from linkedin_url
-- (profileLinksOf) and move here on the profile's next save, so nothing is
-- copied now. Idempotent.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "profile_links" jsonb DEFAULT '{}'::jsonb NOT NULL;
