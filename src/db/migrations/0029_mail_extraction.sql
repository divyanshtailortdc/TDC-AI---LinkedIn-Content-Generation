-- Extraction from received email (src/lib/intel): each email's stories
-- (intel_mentions) and the articles they link to (intel_articles, shared by
-- every workspace and read once). Additive only: emails already stored start
-- as pending and are extracted by the next passes.
CREATE TABLE "intel_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"duplicate_of_id" uuid,
	"title" text,
	"site_name" text,
	"author" text,
	"description" text,
	"published_at" timestamp with time zone,
	"content" text,
	"word_count" integer,
	"content_hash" varchar(64),
	"summary" text,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"key_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intel_articles_canonical_url_unique" UNIQUE("canonical_url"),
	CONSTRAINT "intel_articles_status_check" CHECK ("intel_articles"."status" in ('pending', 'processing', 'done', 'skipped', 'failed', 'duplicate'))
);
--> statement-breakpoint
CREATE TABLE "intel_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"article_id" uuid,
	"position" integer NOT NULL,
	"headline" text NOT NULL,
	"blurb" text,
	"url" text,
	"is_sponsored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "extraction_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "extraction_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "extraction_next_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "extraction_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "extraction_error" text;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "digest_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "digest_summary" text;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD COLUMN "digest_topics" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "intel_articles" ADD CONSTRAINT "intel_articles_duplicate_of_id_intel_articles_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."intel_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD CONSTRAINT "intel_mentions_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD CONSTRAINT "intel_mentions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD CONSTRAINT "intel_mentions_article_id_intel_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."intel_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intel_articles_due_idx" ON "intel_articles" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "intel_articles_content_hash_idx" ON "intel_articles" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "intel_mentions_message_position_uq" ON "intel_mentions" USING btree ("message_id","position");--> statement-breakpoint
CREATE INDEX "intel_mentions_article_idx" ON "intel_mentions" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "intel_mentions_account_idx" ON "intel_mentions" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "mail_messages_extraction_due_idx" ON "mail_messages" USING btree ("extraction_status","extraction_next_at");--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_extraction_status_check" CHECK ("mail_messages"."extraction_status" in ('pending', 'processing', 'done', 'failed'));--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_digest_kind_check" CHECK ("mail_messages"."digest_kind" in ('newsletter', 'promotion', 'transactional', 'other'));