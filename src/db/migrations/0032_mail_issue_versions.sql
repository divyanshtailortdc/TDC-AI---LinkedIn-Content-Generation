-- Versions of a newsletter issue (src/lib/intel/extract-email.ts): an issue
-- sent again (a correction, a resend, the issue at a second address) is a new
-- email row, and the older version points to it. The stories both carry are
-- kept once, with the newer version. Additive only: emails already extracted
-- are left as they are.
ALTER TABLE "mail_messages" ADD COLUMN "superseded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_superseded_by_id_mail_messages_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."mail_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_messages_superseded_by_idx" ON "mail_messages" USING btree ("superseded_by_id") WHERE superseded_by_id is not null;