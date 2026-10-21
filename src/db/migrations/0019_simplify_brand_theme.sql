-- The Brand Theme is now a logo and two colours. Colours already saved in the
-- palette move to their own columns before the other settings are dropped.
ALTER TABLE "brand_themes" ADD COLUMN "primary_color" text;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "secondary_color" text;--> statement-breakpoint
UPDATE "brand_themes" SET "primary_color" = "palette"->>'primary', "secondary_color" = "palette"->>'secondary';--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "logo_dark_image";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "show_logo";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "logo_placement";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "logo_size";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "palette";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "heading_font";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "body_font";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "visual_style";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "style_notes";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "imagery_preferences";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "imagery_avoid";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "text_in_image";--> statement-breakpoint
ALTER TABLE "brand_themes" DROP COLUMN "auto_generate_images";
