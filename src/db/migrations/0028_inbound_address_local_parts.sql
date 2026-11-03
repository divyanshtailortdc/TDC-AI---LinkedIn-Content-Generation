-- Inbound addresses are named after the person who owns the workspace
-- handle plus random characters, and only the part before the @ is stored.
-- A workspace can have several: one current, the rest replaced but still
-- delivering. Rows outlive their workspace (account_id set to null), so an
-- address is never given to anyone else.
--
-- Existing addresses (<handle>-<4 characters>) are kept as replaced ones:
-- mail sent to them still arrives, and each workspace gets its new address
-- the next time it opens Inbox.
ALTER TABLE "inbound_addresses" DROP CONSTRAINT "inbound_addresses_account_id_unique";--> statement-breakpoint
ALTER TABLE "inbound_addresses" DROP CONSTRAINT "inbound_addresses_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "inbound_addresses" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD COLUMN "local_part" text;--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD COLUMN "replaced_at" timestamp with time zone;--> statement-breakpoint
UPDATE "inbound_addresses" SET "local_part" = lower(split_part("address", '@', 1)), "replaced_at" = now();--> statement-breakpoint
ALTER TABLE "inbound_addresses" ALTER COLUMN "local_part" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_addresses" DROP CONSTRAINT "inbound_addresses_address_unique";--> statement-breakpoint
ALTER TABLE "inbound_addresses" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD CONSTRAINT "inbound_addresses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_addresses_current_uq" ON "inbound_addresses" USING btree ("account_id") WHERE replaced_at is null;--> statement-breakpoint
CREATE INDEX "inbound_addresses_account_idx" ON "inbound_addresses" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD CONSTRAINT "inbound_addresses_local_part_unique" UNIQUE("local_part");