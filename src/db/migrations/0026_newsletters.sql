CREATE TABLE "newsletters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"discovered_by_user_id" uuid,
	"name" text NOT NULL,
	"publisher" text NOT NULL,
	"description" text NOT NULL,
	"category" varchar(20) NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relevance_score" integer NOT NULL,
	"relevance_reason" text,
	"website_url" text NOT NULL,
	"signup_url" text NOT NULL,
	"signup_url_key" text NOT NULL,
	"feed_url" text,
	"feed_type" varchar(10),
	"status" varchar(30) DEFAULT 'discovered' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"signup_opened_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletters_status_check" CHECK ("newsletters"."status" in ('discovered', 'saved', 'pending_confirmation', 'subscribed', 'active', 'unsubscribed', 'failed')),
	CONSTRAINT "newsletters_category_check" CHECK ("newsletters"."category" in ('industry', 'niche', 'business', 'technology')),
	CONSTRAINT "newsletters_relevance_score_check" CHECK ("newsletters"."relevance_score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "newsletters" ADD CONSTRAINT "newsletters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletters" ADD CONSTRAINT "newsletters_discovered_by_user_id_auth_users_id_fk" FOREIGN KEY ("discovered_by_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletters_account_signup_key_uq" ON "newsletters" USING btree ("account_id","signup_url_key");--> statement-breakpoint
CREATE INDEX "newsletters_account_score_idx" ON "newsletters" USING btree ("account_id","relevance_score");--> statement-breakpoint
CREATE INDEX "newsletters_account_status_idx" ON "newsletters" USING btree ("account_id","status");