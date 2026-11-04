-- Unsubscribing from a newsletter (src/lib/intel/extract-email.ts): every
-- email from the sender carries the date. Nothing stored is deleted; runs stop
-- using its stories and new mail from it is not read. Additive only.
ALTER TABLE "mail_messages" ADD COLUMN "sender_unsubscribed_at" timestamp with time zone;