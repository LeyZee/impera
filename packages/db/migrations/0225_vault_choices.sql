CREATE TABLE "vault_describe_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"platform_media_id" text NOT NULL,
	"asked_key" uuid NOT NULL,
	"asked_by" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_describe_requests_media_unique" UNIQUE("platform_account_id","platform_media_id")
);
--> statement-breakpoint
ALTER TABLE "vault_describe_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault_import_choices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"folder_ref" text,
	"platform_media_id" text,
	"imported" boolean NOT NULL,
	"chosen_by" text NOT NULL,
	"chosen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_import_choices_scope_check" CHECK ("vault_import_choices"."scope" in ('folder', 'media')),
	CONSTRAINT "vault_import_choices_target_check" CHECK (("vault_import_choices"."scope" = 'folder' and "vault_import_choices"."platform_media_id" is null) or ("vault_import_choices"."scope" = 'media' and "vault_import_choices"."platform_media_id" is not null and "vault_import_choices"."folder_ref" is null)),
	CONSTRAINT "vault_import_choices_text_check" CHECK (char_length("vault_import_choices"."folder_ref") <= 200 and char_length("vault_import_choices"."platform_media_id") <= 200)
);
--> statement-breakpoint
ALTER TABLE "vault_import_choices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vault_describe_requests" ADD CONSTRAINT "vault_describe_requests_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_describe_requests" ADD CONSTRAINT "vault_describe_requests_asked_by_user_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_describe_requests" ADD CONSTRAINT "vault_describe_requests_ref_fk" FOREIGN KEY ("platform_account_id","platform_media_id") REFERENCES "public"."media_platform_refs"("platform_account_id","platform_media_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_describe_requests" ADD CONSTRAINT "vault_describe_requests_account_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_import_choices" ADD CONSTRAINT "vault_import_choices_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_import_choices" ADD CONSTRAINT "vault_import_choices_chosen_by_user_id_fk" FOREIGN KEY ("chosen_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_import_choices" ADD CONSTRAINT "vault_import_choices_account_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vault_describe_requests_key_idx" ON "vault_describe_requests" USING btree ("creator_id","asked_key");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_import_choices_folder_unique" ON "vault_import_choices" USING btree ("platform_account_id",coalesce("folder_ref", '')) WHERE "vault_import_choices"."scope" = 'folder';--> statement-breakpoint
CREATE UNIQUE INDEX "vault_import_choices_media_unique" ON "vault_import_choices" USING btree ("platform_account_id","platform_media_id") WHERE "vault_import_choices"."scope" = 'media';--> statement-breakpoint
CREATE INDEX "vault_import_choices_creator_idx" ON "vault_import_choices" USING btree ("creator_id","platform_account_id");--> statement-breakpoint
CREATE POLICY "team_read" ON "vault_describe_requests" AS PERMISSIVE FOR SELECT TO public USING ("vault_describe_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_ask" ON "vault_describe_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("vault_describe_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "vault_describe_requests"."asked_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "vault_describe_requests" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "team_read" ON "vault_import_choices" AS PERMISSIVE FOR SELECT TO public USING ("vault_import_choices"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_write" ON "vault_import_choices" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("vault_import_choices"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "vault_import_choices"."chosen_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_change" ON "vault_import_choices" AS PERMISSIVE FOR UPDATE TO public USING ("vault_import_choices"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK ("vault_import_choices"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "vault_import_choices"."chosen_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_clear" ON "vault_import_choices" AS PERMISSIVE FOR DELETE TO public USING ("vault_import_choices"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "vault_import_choices" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- What enters the CRM of a vault, and what the owner asked to describe (ADR 0145 § 5, amendment of 17/11): set by the
-- owner alone under her RLS, read by the owner and the active managers, closed to her account; read by the jobs as
-- the service role. Nothing existing is ticked: every vault media starts out of the CRM.
ALTER TABLE "vault_import_choices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vault_describe_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app reads and sets the ticks, and adds a request it never
-- changes nor removes.
REVOKE ALL ON "vault_import_choices" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vault_import_choices" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "vault_import_choices" TO impera_service;--> statement-breakpoint
REVOKE ALL ON "vault_describe_requests" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "vault_describe_requests" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "vault_describe_requests" TO impera_service;
