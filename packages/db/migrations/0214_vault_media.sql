-- ADR 0113 § 1, § 3, § 5: a vault media is born erased (origin `vault`, `storage_key` empty, only then), the
-- platform's own text is a description of its own (author `platform`, never validated), and a vault media that could not
-- be described counts its tries until it waits for the agency's text.
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_origin_check";--> statement-breakpoint
ALTER TABLE "media_descriptions" DROP CONSTRAINT "media_descriptions_author_check";--> statement-breakpoint
ALTER TABLE "media_platform_refs" ADD COLUMN "description_failures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_storage_key_check" CHECK (("media_assets"."storage_key" = '') = ("media_assets"."origin" = 'vault') and ("media_assets"."origin" <> 'vault' or "media_assets"."erased_at" is not null));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_origin_check" CHECK ("media_assets"."origin" in ('creator', 'fan', 'vault'));--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_author_check" CHECK ("media_descriptions"."author" in ('sense', 'human', 'platform'));--> statement-breakpoint
ALTER TABLE "media_platform_refs" ADD CONSTRAINT "media_platform_refs_description_failures_check" CHECK ("media_platform_refs"."description_failures" >= 0);--> statement-breakpoint
-- Written by hand. Drizzle does not write what follows.
-- ADR 0113 § 5 and ADR 0087: `media.describe_vault` links a vault media to the asset it made, and counts the tries that
-- could not describe it, as the service role; it writes nothing else of this table, which `connector.vault_sync` keeps.
GRANT UPDATE ("media_asset_id", "description_failures") ON "media_platform_refs" TO impera_service;
