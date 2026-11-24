CREATE TABLE IF NOT EXISTS "visual_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" varchar(30) NOT NULL,
	"source" varchar(10) NOT NULL,
	"image_url" text NOT NULL,
	"post_url" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visual_examples_source_check" CHECK ("visual_examples"."source" in ('search', 'buffer', 'upload'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "visual_examples" ADD CONSTRAINT "visual_examples_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visual_examples_account_platform_idx" ON "visual_examples" USING btree ("account_id","platform");
