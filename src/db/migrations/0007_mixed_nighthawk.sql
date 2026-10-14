ALTER TABLE "goals" DROP CONSTRAINT "goals_audience_id_audiences_id_fk";
--> statement-breakpoint
ALTER TABLE "schedules" DROP CONSTRAINT "schedules_preference_id_preferences_id_fk";
--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "audience_id";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "proof_asset_ids";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "link_strategy";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "success_metric";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "weight";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "start_date";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "end_date";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "dos";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "donts";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "target_count";--> statement-breakpoint
ALTER TABLE "preferences" DROP COLUMN "posts_per_week";--> statement-breakpoint
ALTER TABLE "preferences" DROP COLUMN "formats";--> statement-breakpoint
ALTER TABLE "preferences" DROP COLUMN "cadence";--> statement-breakpoint
ALTER TABLE "preferences" DROP COLUMN "research_policy";--> statement-breakpoint
ALTER TABLE "preferences" DROP COLUMN "media_policy";--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN "preference_id";--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN "frequency";--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN "posts_per_run";--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN "ideas_per_run";--> statement-breakpoint
ALTER TABLE "schedules" DROP COLUMN "next_run_at";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "warmth";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "humor";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "energy";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "story_vs_data";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "sentence_length";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "paragraph_style";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "reading_level_target";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "signature_phrases";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "opening_styles";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "closing_styles";--> statement-breakpoint
ALTER TABLE "voice_configs" DROP COLUMN "rules";