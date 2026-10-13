ALTER TABLE "preferences" ADD COLUMN "ideas_per_run" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
-- Ideas per run moves out of the cadence policy into its own column. Runs read
-- cadence.ideas_per_run and clamped it to 3-12, so carry that value across.
-- The cadence column itself stays until the deferred cleanup migration.
UPDATE "preferences"
SET "ideas_per_run" = LEAST(GREATEST(ROUND(("cadence"->>'ideas_per_run')::numeric)::integer, 3), 12)
WHERE jsonb_typeof("cadence"->'ideas_per_run') = 'number';
