-- The usage ledger (src/lib/ai/spend.ts): one row per paid model call,
-- whatever made it, charged to the user and identity it was for. Spend
-- outside runs (newsletters, setup, post editing) used to go unrecorded, and
-- the per-user spending limit reads this. Idempotent.
CREATE TABLE IF NOT EXISTS "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"account_id" uuid,
	"run_id" uuid,
	"source" varchar(20) NOT NULL,
	"stage" varchar(30) NOT NULL,
	"model" varchar(100) NOT NULL,
	"calls" integer DEFAULT 1 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 8) DEFAULT '0' NOT NULL,
	"cost_estimated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_source_check" CHECK ("ai_usage"."source" in ('runs', 'posts', 'newsletters', 'identity', 'unscoped'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_user_created_idx" ON "ai_usage" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_account_created_idx" ON "ai_usage" USING btree ("account_id","created_at");
--> statement-breakpoint
-- Spend recorded before the ledger: every billed run step, charged to its
-- run's identity and that identity's owner, so the usage cards and the
-- limit's 30-day window start out complete. Edits made on a post after its
-- run were charged to the run's steps, so they come over as 'runs' too.
-- Only into an empty ledger, so running this again copies nothing twice.
INSERT INTO "ai_usage" (
	"user_id", "account_id", "run_id", "source", "stage", "model", "calls",
	"input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
	"reasoning_tokens", "total_tokens", "cost_usd", "cost_estimated", "created_at"
)
SELECT
	a."user_id",
	r."account_id",
	r."id",
	'runs',
	left(s."stage", 30),
	left(coalesce(s."response_json"->>'model', 'unknown'), 100),
	coalesce(nullif(round((u.usage->>'calls')::numeric), 0), 1)::integer,
	coalesce(round((u.usage->>'inputTokens')::numeric), 0)::integer,
	coalesce(round((u.usage->>'outputTokens')::numeric), 0)::integer,
	coalesce(round((u.usage->>'cacheReadTokens')::numeric), 0)::integer,
	coalesce(round((u.usage->>'cacheWriteTokens')::numeric), 0)::integer,
	coalesce(round((u.usage->>'reasoningTokens')::numeric), 0)::integer,
	coalesce(round((u.usage->>'totalTokens')::numeric), s."tokens", 0)::integer,
	coalesce((u.usage->>'costUsd')::numeric, s."cost_usd", 0),
	coalesce((u.usage->>'estimatedCalls')::numeric, 0) > 0,
	coalesce(s."completed_at", s."created_at")
FROM "run_steps" s
JOIN "runs" r ON r."id" = s."run_id"
LEFT JOIN "accounts" a ON a."id" = r."account_id"
CROSS JOIN LATERAL (SELECT s."response_json"->'usage' AS usage) u
WHERE (
		coalesce((u.usage->>'calls')::numeric, 0) > 0
		OR coalesce(s."cost_usd", 0) > 0
	)
	AND NOT EXISTS (SELECT 1 FROM "ai_usage");
