-- The public post an idea was made from ("a post like this one", see
-- src/lib/reference-post): its link and what could be read of it, which
-- drafting writes a similar post from. Null for ideas from a run. Idempotent.
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "reference" jsonb;
