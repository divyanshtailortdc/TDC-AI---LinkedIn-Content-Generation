-- Each idea's scores with their reasons (src/lib/idea-scorecard): originality,
-- trend relevance, brand fit and engagement potential from the idea review,
-- and source quality over the facts it states. Null for older ideas. Idempotent.
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "scorecard" jsonb;
