-- Whether ideas may use a newsletter story: automatically while it is recent
-- (every story so far), kept past that, or never; set from the Knowledge
-- base's "From newsletters" view. Additive. It replaces copying an article
-- into the Knowledge base: nothing is duplicated to keep or exclude a story.
ALTER TABLE "intel_mentions" ADD COLUMN "use_in_ideas" varchar(10) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD CONSTRAINT "intel_mentions_use_in_ideas_check" CHECK ("intel_mentions"."use_in_ideas" in ('auto', 'keep', 'never'));