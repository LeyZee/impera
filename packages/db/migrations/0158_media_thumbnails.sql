-- ADR 0030 § 4 and ADR 0044 § 2, SC-04 lot c4: each photo and video of her library gets a reduced picture for the
-- agency's screen, a JPEG of its own key, kept after the original is erased. `thumbnailed_at` says it was tried: a medium
-- whose file ffmpeg cannot read keeps no picture, and is not tried again. A voice note has none.
ALTER TABLE "media_assets" ADD COLUMN "thumbnail_key" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "thumbnailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_thumbnail_check" CHECK ("media_assets"."thumbnail_key" is null or ("media_assets"."thumbnailed_at" is not null and "media_assets"."kind" <> 'audio'));