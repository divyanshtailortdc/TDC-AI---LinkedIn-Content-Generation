ALTER TABLE "knowledge_documents" ADD COLUMN "author" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "word_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "topics" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "key_claims" jsonb DEFAULT '[]'::jsonb;