CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"draft_id" uuid,
	"verdict" varchar(20) NOT NULL,
	"reason_tags" jsonb DEFAULT '[]'::jsonb,
	"reason_text" text,
	"original_body" text,
	"final_body" text,
	"edit_distance" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"claim" text NOT NULL,
	"quote" text,
	"source_url" text,
	"source_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"previous_media_id" uuid,
	"regeneration_attempt" integer DEFAULT 0 NOT NULL,
	"rejection_reason" text,
	"mode" varchar(20) NOT NULL,
	"image_url" text,
	"alt_text" text,
	"prompt_or_query" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"variant_type" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"snippet" text,
	"published_at" text,
	"provider" varchar(50) DEFAULT 'web_search',
	"retrieved_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"request_summary" text,
	"response_json" jsonb,
	"tokens" integer DEFAULT 0,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"preference_id" uuid,
	"frequency" varchar(20) DEFAULT 'weekly' NOT NULL,
	"days_of_week" jsonb DEFAULT '[1,3,5]'::jsonb,
	"time_of_day" varchar(10) DEFAULT '09:00' NOT NULL,
	"posts_per_run" integer DEFAULT 1 NOT NULL,
	"ideas_per_run" integer DEFAULT 3 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ideas" ALTER COLUMN "status" SET DEFAULT 'proposed';--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "workflow" SET DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "voice_configs" ALTER COLUMN "perspective" SET DEFAULT 'I';--> statement-breakpoint
ALTER TABLE "voice_configs" ALTER COLUMN "banned_words" SET DEFAULT '["delve","leverage","unlock","game-changer","fast-paced world","thrilled to announce"]'::jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "job_titles" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "seniority" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "industries" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "company_size" text;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "geography" text;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "desires" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "objections" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "sophistication_level" varchar(20) DEFAULT 'practitioner' NOT NULL;--> statement-breakpoint
ALTER TABLE "audiences" ADD COLUMN "what_they_dont_believe_yet" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "cta" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "first_comment" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "format" varchar(50) DEFAULT 'thought_leadership';--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "self_scores" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "self_flags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "lint_findings" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "edited_body" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "audience_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "key_message" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "proof_asset_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "desired_action" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_url" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "link_strategy" varchar(20) DEFAULT 'first_comment' NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "success_metric" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "weight" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "end_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "dos" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "donts" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "title" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "format" varchar(50) DEFAULT 'thought_leadership';--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "thesis" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "perspective_angle" varchar(100);--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "why_now" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "hook_concept" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "core_argument" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "audience_takeaway" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "supporting_evidence" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "suggested_media" jsonb DEFAULT '{"mode":"none"}'::jsonb;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "novelty_note" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "grounding_score" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "originality_score" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "unsupported_claims" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "source_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "risks" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "offerings" ADD COLUMN "who_it_is_for" text;--> statement-breakpoint
ALTER TABLE "offerings" ADD COLUMN "problem_solved" text;--> statement-breakpoint
ALTER TABLE "offerings" ADD COLUMN "key_features" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "offerings" ADD COLUMN "differentiators" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "offerings" ADD COLUMN "pricing_note" text;--> statement-breakpoint
ALTER TABLE "offerings" ADD COLUMN "proof_points" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "formats" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "cadence" jsonb;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "research_policy" jsonb;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "media_policy" jsonb;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "post_constraints" jsonb;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "guardrails" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "goal_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "preference_set_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "trigger" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "research_config" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "media_config" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "timings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "token_counts" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cost_usd" numeric(10, 4) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "model" varchar(100) DEFAULT 'claude-opus-5';--> statement-breakpoint
ALTER TABLE "sample_posts" ADD COLUMN "performed_well" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_posts" ADD COLUMN "engagement_note" text;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "warmth" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "directness" integer DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "humor" varchar(30) DEFAULT 'dry' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "energy" varchar(30) DEFAULT 'measured' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "story_vs_data" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "emoji_policy" varchar(30) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "hashtag_policy" varchar(100) DEFAULT '0-3, end of post' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "sentence_length" varchar(30) DEFAULT 'short' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "paragraph_style" varchar(50) DEFAULT 'short paras' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "reading_level_target" varchar(50) DEFAULT 'grade 7-9' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "signature_phrases" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "opening_styles" jsonb DEFAULT '["concrete scene","bold claim","question"]'::jsonb;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "closing_styles" jsonb DEFAULT '["question CTA","soft takeaway"]'::jsonb;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "derived_style_rubric" text;--> statement-breakpoint
ALTER TABLE "voice_configs" ADD COLUMN "raw_samples_text" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_citations" ADD CONSTRAINT "post_citations_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_variants" ADD CONSTRAINT "post_variants_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_preference_id_preferences_id_fk" FOREIGN KEY ("preference_id") REFERENCES "public"."preferences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_preference_set_id_preferences_id_fk" FOREIGN KEY ("preference_set_id") REFERENCES "public"."preferences"("id") ON DELETE set null ON UPDATE no action;