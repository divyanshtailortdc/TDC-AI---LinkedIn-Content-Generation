-- One Buffer OAuth connection per user (docs/BUFFER_OAUTH.md), the channels
-- in that Buffer account, and the link from each network's publishing
-- connection to it. Additive only: connections made earlier (each with its own
-- Buffer token or pasted API key) keep working untouched until their owner
-- connects Buffer. Idempotent.
CREATE TABLE IF NOT EXISTS "buffer_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"organization_id" text,
	"service" varchar(40) NOT NULL,
	"channel_type" varchar(40),
	"name" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"external_link" text,
	"is_disconnected" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buffer_channels_connection_channel_unique" UNIQUE("connection_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "buffer_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"buffer_account_id" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buffer_connections_user_unique" UNIQUE("user_id"),
	CONSTRAINT "buffer_connections_status_check" CHECK ("buffer_connections"."status" in ('connected', 'expired', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "linkedin_connections" ADD COLUMN IF NOT EXISTS "buffer_connection_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buffer_channels" ADD CONSTRAINT "buffer_channels_connection_id_buffer_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."buffer_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buffer_channels" ADD CONSTRAINT "buffer_channels_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buffer_connections" ADD CONSTRAINT "buffer_connections_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buffer_channels_user_service_idx" ON "buffer_channels" USING btree ("user_id","service");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buffer_connections_account_idx" ON "buffer_connections" USING btree ("buffer_account_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "linkedin_connections" ADD CONSTRAINT "linkedin_connections_buffer_connection_fk" FOREIGN KEY ("buffer_connection_id") REFERENCES "public"."buffer_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "linkedin_connections_buffer_connection_idx" ON "linkedin_connections" USING btree ("buffer_connection_id") WHERE "linkedin_connections"."buffer_connection_id" is not null;