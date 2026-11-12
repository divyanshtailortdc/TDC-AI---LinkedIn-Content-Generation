-- A user can own several identities, and each identity publishes through its
-- own connections. Idempotent.
--
-- 1. Identities: one user, many accounts rows.
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_user_id_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
-- 2. Connections belong to an identity. Each existing one goes to its owner's
-- oldest identity (every owner had at most one); a connection whose owner has
-- no identity yet keeps a null account_id until they create one.
ALTER TABLE "linkedin_connections" ADD COLUMN IF NOT EXISTS "account_id" uuid;--> statement-breakpoint
UPDATE "linkedin_connections" AS c
SET "account_id" = (
  SELECT a."id" FROM "accounts" AS a
  WHERE a."user_id" = c."user_id"
  ORDER BY a."created_at" ASC
  LIMIT 1
)
WHERE c."account_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "linkedin_connections" ADD CONSTRAINT "linkedin_connections_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "linkedin_connections" DROP CONSTRAINT IF EXISTS "linkedin_connections_user_platform_unique";--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "linkedin_connections" ADD CONSTRAINT "linkedin_connections_account_platform_unique" UNIQUE("account_id","platform");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_connections_user_idx" ON "linkedin_connections" USING btree ("user_id");--> statement-breakpoint
-- 3. Publications record whose post they are, so cancelling and publishing
-- reach only that identity's connection.
ALTER TABLE "linkedin_publications" ADD COLUMN IF NOT EXISTS "account_id" uuid;--> statement-breakpoint
UPDATE "linkedin_publications" AS p
SET "account_id" = d."account_id"
FROM "post_drafts" AS d
WHERE d."id" = p."draft_id" AND p."account_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "linkedin_publications" ADD CONSTRAINT "linkedin_publications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
