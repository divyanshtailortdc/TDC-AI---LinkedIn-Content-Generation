-- Each post is written for one platform (src/lib/platforms). Every post so far
-- was written for LinkedIn, the default. Publication error codes that named
-- LinkedIn are renamed to the platform-neutral ones the code now uses.
ALTER TABLE "post_drafts" ADD COLUMN "platform" varchar(30) DEFAULT 'linkedin' NOT NULL;--> statement-breakpoint
UPDATE "linkedin_publications" SET "error_code" = 'platform_unavailable' WHERE "error_code" = 'linkedin_unavailable';--> statement-breakpoint
UPDATE "linkedin_publications" SET "error_code" = 'rejected_by_platform' WHERE "error_code" = 'rejected_by_linkedin';
