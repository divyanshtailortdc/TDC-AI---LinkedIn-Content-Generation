-- Brand themes: how an identity's generated images look, with its logo.
-- post_media.base_image_url keeps a generated image before the logo is laid
-- over it. Additive only.
CREATE TABLE "brand_themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"logo_image" text,
	"logo_dark_image" text,
	"show_logo" boolean DEFAULT true NOT NULL,
	"logo_placement" varchar(20) DEFAULT 'top_left' NOT NULL,
	"logo_size" varchar(10) DEFAULT 'medium' NOT NULL,
	"palette" jsonb DEFAULT '{}'::jsonb,
	"heading_font" text,
	"body_font" text,
	"visual_style" varchar(30) DEFAULT 'auto' NOT NULL,
	"style_notes" text,
	"imagery_preferences" text,
	"imagery_avoid" text,
	"text_in_image" varchar(20) DEFAULT 'headline' NOT NULL,
	"auto_generate_images" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_themes_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "base_image_url" text;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD CONSTRAINT "brand_themes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;