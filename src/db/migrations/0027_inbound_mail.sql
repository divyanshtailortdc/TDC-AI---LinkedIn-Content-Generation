-- Inbound mail from our own IMAP server: each identity's address, the app's
-- cursor in the mailbox it reads, and the emails received. Additive only.
CREATE TABLE "inbound_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_addresses_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "inbound_addresses_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"uid_validity" bigint NOT NULL,
	"uid" bigint NOT NULL,
	"message_id_header" text,
	"from_name" text,
	"from_address" text,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"snippet" text,
	"text_body" text,
	"html_body" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(subject, '')), 'A') || setweight(to_tsvector('simple', coalesce(from_name, '') || ' ' || coalesce(from_address, '') || ' ' || translate(coalesce(from_address, ''), '@.', '  ')), 'B') || setweight(to_tsvector('simple', left(coalesce(text_body, ''), 100000)), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mailbox" text NOT NULL,
	"uid_validity" bigint,
	"last_uid" bigint DEFAULT 0 NOT NULL,
	"sync_lease_until" timestamp with time zone,
	"sync_requested_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_sync_state_mailbox_unique" UNIQUE("mailbox")
);
--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD CONSTRAINT "inbound_addresses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_mailbox_id_mail_sync_state_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mail_sync_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_uid_uq" ON "mail_messages" USING btree ("mailbox_id","uid_validity","uid");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_account_message_id_uq" ON "mail_messages" USING btree ("account_id","message_id_header") WHERE message_id_header is not null;--> statement-breakpoint
CREATE INDEX "mail_messages_account_received_idx" ON "mail_messages" USING btree ("account_id","received_at","id");--> statement-breakpoint
CREATE INDEX "mail_messages_search_idx" ON "mail_messages" USING gin ("search_vector");