-- Each signed-in user owns at most one identity. Fails while any user owns
-- more than one; find them with:
--   SELECT user_id, count(*) FROM accounts
--   WHERE user_id IS NOT NULL GROUP BY user_id HAVING count(*) > 1;
-- Unowned legacy identities (user_id NULL) are unaffected.
DROP INDEX "accounts_user_handle_uq";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_unique" UNIQUE("user_id");--> statement-breakpoint
-- Identities can no longer be deactivated. Those that were keep their
-- scheduled runs off instead of starting again.
UPDATE "schedules" SET "enabled" = false WHERE "account_id" IN (SELECT "id" FROM "accounts" WHERE "is_active" = false);
