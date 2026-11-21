-- Vault screen (ADR 0030 § 4, ADR 0099): the platform's blurred preview of a vault media, a blurhash (a few colours
-- computed from the image, never the image nor a link), drawn as the media's tile. NULL: none given, or not readable.
-- Additive, no data touched: the next sync fills it.
ALTER TABLE "media_platform_refs" ADD COLUMN "preview_blurhash" text;--> statement-breakpoint
ALTER TABLE "media_platform_refs" ADD CONSTRAINT "media_platform_refs_blurhash_check" CHECK (char_length("media_platform_refs"."preview_blurhash") <= 166);
