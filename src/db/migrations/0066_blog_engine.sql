-- Blog engine: what a generated blog or article keeps beside its text now.
-- The questions people search about its topic ("People also ask" and related
-- searches) and the pictures made for its sections, which image nodes in the
-- text name by id. Additive and idempotent: it can run again without harm.
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "search_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN IF NOT EXISTS "images" jsonb DEFAULT '[]'::jsonb NOT NULL;
