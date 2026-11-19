-- Searching the help pages by meaning (a question asked in the docs search)
-- embeds the question, so it is recorded under a source of its own, 'help'
-- (src/lib/ai/spend-sources.ts). Nothing recorded before changes. Idempotent.
ALTER TABLE "ai_usage" DROP CONSTRAINT IF EXISTS "ai_usage_source_check";--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_source_check" CHECK ("ai_usage"."source" in ('runs', 'posts', 'newsletters', 'inbox', 'identity', 'help', 'unscoped'));
