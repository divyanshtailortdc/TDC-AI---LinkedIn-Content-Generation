ALTER TABLE "voice_configs" ALTER COLUMN "banned_words" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
-- Rows still holding the old column default never chose these words; clear them.
UPDATE "voice_configs" SET "banned_words" = '[]'::jsonb
WHERE "banned_words" = '["delve", "leverage", "unlock", "game-changer", "fast-paced world", "thrilled to announce"]'::jsonb;
