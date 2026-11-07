-- Hiding and deleting posts. A post's LinkedIn publications outlive it (draft_id
-- set null) as the record of what was published; deleted_at marks a post the
-- user deleted from LinkedIn itself.
ALTER TABLE "linkedin_publications" DROP CONSTRAINT "linkedin_publications_draft_id_post_drafts_id_fk";
--> statement-breakpoint
ALTER TABLE "linkedin_publications" ALTER COLUMN "draft_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "linkedin_publications" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "linkedin_publications" ADD CONSTRAINT "linkedin_publications_draft_id_post_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."post_drafts"("id") ON DELETE set null ON UPDATE no action;