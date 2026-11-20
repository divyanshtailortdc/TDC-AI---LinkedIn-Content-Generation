ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "draft_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_draft_idx" ON "ai_usage" USING btree ("draft_id");