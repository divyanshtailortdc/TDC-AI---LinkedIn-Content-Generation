-- The one platform each scheduled day's run plans ideas for; null (every
-- existing schedule) plans for every platform. Idempotent.
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "day_platforms" jsonb;
