-- The platforms a goal's posts go on; empty (every existing goal) is every
-- platform the identity posts on. Idempotent.
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "platforms" jsonb DEFAULT '[]'::jsonb NOT NULL;
