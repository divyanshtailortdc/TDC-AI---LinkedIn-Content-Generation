-- Every image is now laid out by the canvas renderer (src/lib/media/canvas):
-- the brand's accent and background colours, fonts, visual style, background
-- pattern, logo toggle and the website or handle in the corner. The old
-- secondary colour becomes the accent.
ALTER TABLE "brand_themes" RENAME COLUMN "secondary_color" TO "accent_color";--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "show_logo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "background_color" text;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "heading_font" text;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "body_font" text;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "visual_style" varchar(20) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "background_pattern" varchar(20) DEFAULT 'dots' NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_themes" ADD COLUMN "footer_text" text;