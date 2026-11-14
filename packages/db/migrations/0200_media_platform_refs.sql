-- Vault sync (migration 0200, ADR 0030 § 1, ADR 0099 § 2 to 4, fiche vault-sync): the platform's vault as the CRM
-- mirrors it, one row per media of an account, its folder, its moment and its order as the platform lists them; never a
-- file (`media_asset_id` stays empty until a fetch), never deleted (`removed_at`). Written by `connector.vault_sync`
-- inside the creator's tenant (withTenant): nirvana_app selects, inserts and updates, never deletes; read-only to her
-- own account. `platform_accounts.vault_synced_at`: the account's last vault sync that went through; a sync where
-- nothing moved writes only that time.
CREATE TABLE "media_platform_refs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"platform_media_id" text NOT NULL,
	"media_asset_id" uuid,
	"kind" text NOT NULL,
	"folder_ref" text,
	"folder_name" text,
	"folder_moment" text,
	"folder_position" integer NOT NULL,
	"platform_created_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer,
	"platform_description" text,
	"suggested_min_minor" integer,
	"suggested_max_minor" integer,
	"last_synced_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_platform_refs_account_media_unique" UNIQUE("platform_account_id","platform_media_id"),
	CONSTRAINT "media_platform_refs_platform_check" CHECK ("media_platform_refs"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "media_platform_refs_kind_check" CHECK ("media_platform_refs"."kind" in ('image', 'video', 'audio')),
	CONSTRAINT "media_platform_refs_folder_check" CHECK (("media_platform_refs"."folder_ref" is null) = ("media_platform_refs"."folder_name" is null) and ("media_platform_refs"."folder_ref" is not null or "media_platform_refs"."folder_moment" is null)),
	CONSTRAINT "media_platform_refs_folder_moment_check" CHECK ("media_platform_refs"."folder_moment" in ('day', 'night')),
	CONSTRAINT "media_platform_refs_folder_position_check" CHECK ("media_platform_refs"."folder_position" >= 0),
	CONSTRAINT "media_platform_refs_suggested_check" CHECK (("media_platform_refs"."suggested_min_minor" is null) = ("media_platform_refs"."suggested_max_minor" is null) and coalesce("media_platform_refs"."suggested_min_minor", 0) >= 0 and coalesce("media_platform_refs"."suggested_max_minor", 0) >= 0),
	CONSTRAINT "media_platform_refs_duration_check" CHECK ("media_platform_refs"."duration_seconds" is null or "media_platform_refs"."duration_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "media_platform_refs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD COLUMN "vault_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_platform_refs" ADD CONSTRAINT "media_platform_refs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_platform_refs" ADD CONSTRAINT "media_platform_refs_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_platform_refs" ADD CONSTRAINT "media_platform_refs_account_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_platform_refs_order_idx" ON "media_platform_refs" USING btree ("creator_id","folder_ref","platform_created_at","folder_position","platform_media_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "media_platform_refs" AS PERMISSIVE FOR ALL TO public USING ("media_platform_refs"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("media_platform_refs"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_no_insert" ON "media_platform_refs" AS RESTRICTIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_update" ON "media_platform_refs" AS RESTRICTIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_delete" ON "media_platform_refs" AS RESTRICTIVE FOR DELETE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');
--> statement-breakpoint
-- Written by hand. Drizzle does not write what follows.
ALTER TABLE "media_platform_refs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "media_platform_refs" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "media_platform_refs" TO nirvana_app;--> statement-breakpoint
-- ADR 0087 (#716): the service role reads every table, and writes none of this one.
GRANT SELECT ON "media_platform_refs" TO impera_service;
