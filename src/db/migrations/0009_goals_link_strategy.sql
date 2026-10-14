-- Restores goals.link_strategy, which 0007 dropped. Link placement moved from
-- preferences onto each goal (the "Links Go In" field beside its link), so the
-- column is in use again. Dropped values were all 'first_comment', the default.
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "link_strategy" varchar(20) DEFAULT 'first_comment' NOT NULL;
