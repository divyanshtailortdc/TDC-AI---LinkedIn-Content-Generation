-- Switching an identity to another company (src/lib/identity-switch.ts).
-- context_since: prompts read only the posts, ideas and rejections made
-- since the last switch. context_identity: the company the voice, knowledge
-- and goals were set up for, while the profile has been changed by hand to
-- another one. Both null for every existing identity. Idempotent.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "context_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "context_identity" jsonb;
