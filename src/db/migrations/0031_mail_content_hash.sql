-- The same email is stored once per identity even without a Message-ID, or
-- when it is resent under a new one: a digest of its sender, subject and both
-- bodies as stored (contentHashOf, src/lib/mail/parse-message.ts), unique per
-- identity. Both ways in insert with ON CONFLICT DO NOTHING, so the new index
-- refuses the copies with no change to them.
--
-- Mail stored before this gets the same digest, computed here in SQL; it must
-- match contentHashOf byte for byte. Of the copies already stored, the first
-- received is kept and the later ones are deleted (with their stories), so
-- the index can be built.
ALTER TABLE "mail_messages" ADD COLUMN "content_hash" varchar(64);--> statement-breakpoint
UPDATE "mail_messages" SET "content_hash" = encode(sha256(convert_to(coalesce("from_address", '') || E'\n' || coalesce("subject", '') || E'\n' || coalesce("html_body", '') || E'\n' || coalesce("text_body", ''), 'UTF8')), 'hex') WHERE "html_body" IS NOT NULL OR "text_body" IS NOT NULL;--> statement-breakpoint
DELETE FROM "mail_messages" AS "copy" USING "mail_messages" AS "first" WHERE "copy"."account_id" = "first"."account_id" AND "copy"."content_hash" = "first"."content_hash" AND ("first"."received_at", "first"."id") < ("copy"."received_at", "copy"."id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_account_content_hash_uq" ON "mail_messages" USING btree ("account_id","content_hash") WHERE content_hash is not null;
