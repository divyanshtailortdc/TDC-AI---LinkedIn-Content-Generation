-- Reading received email gets a source of its own, 'inbox', apart from
-- discovering newsletters ('newsletters'): anyone who knows an inbox address
-- can start that work, so it has spending limits of its own
-- (src/lib/ai/spend.ts). What was recorded before moves over: the email
-- digest and article summaries ('extraction') and the story embeddings
-- ('embedding'); discovery is recorded as 'identity_setup'. Idempotent.
ALTER TABLE "ai_usage" DROP CONSTRAINT IF EXISTS "ai_usage_source_check";--> statement-breakpoint
UPDATE "ai_usage" SET "source" = 'inbox' WHERE "source" = 'newsletters' AND "stage" IN ('extraction', 'embedding');--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_source_check" CHECK ("ai_usage"."source" in ('runs', 'posts', 'newsletters', 'inbox', 'identity', 'unscoped'));
