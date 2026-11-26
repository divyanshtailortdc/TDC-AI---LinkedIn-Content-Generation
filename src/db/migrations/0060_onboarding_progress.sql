-- The guided onboarding journey (src/lib/onboarding). Progress is worked out
-- from the data each step saves; this table keeps only what that data cannot
-- show: optional steps skipped, defaults confirmed, the guide bar hidden.
-- One row per identity, made on the first skip, confirm or hide. Additive
-- and idempotent.
CREATE TABLE IF NOT EXISTS "onboarding_progress" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
