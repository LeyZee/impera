CREATE TABLE "prepared_scripts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"state" text DEFAULT 'editing' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"matched_platform_script_id" uuid,
	"matched_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepared_scripts_state_check" CHECK ("prepared_scripts"."state" in ('editing', 'ready_to_copy', 'matched')),
	CONSTRAINT "prepared_scripts_revision_check" CHECK ("prepared_scripts"."revision" >= 1),
	CONSTRAINT "prepared_scripts_matched_check" CHECK (("prepared_scripts"."state" = 'matched') = ("prepared_scripts"."matched_platform_script_id" is not null and "prepared_scripts"."matched_at" is not null)),
	CONSTRAINT "prepared_scripts_content_check" CHECK (jsonb_typeof("prepared_scripts"."content") = 'object' and jsonb_typeof("prepared_scripts"."content"->'steps') = 'array')
);
--> statement-breakpoint
ALTER TABLE "prepared_scripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_matched_creator_fk" FOREIGN KEY ("matched_platform_script_id","creator_id") REFERENCES "public"."platform_scripts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prepared_scripts_creator_idx" ON "prepared_scripts" USING btree ("creator_id","updated_at");--> statement-breakpoint
CREATE POLICY "team_read" ON "prepared_scripts" AS PERMISSIVE FOR SELECT TO public USING ("prepared_scripts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "team_write" ON "prepared_scripts" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("prepared_scripts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "prepared_scripts"."created_by" = nullif(current_setting('app.user_id', true), '') and "prepared_scripts"."updated_by" = nullif(current_setting('app.user_id', true), '') and "prepared_scripts"."state" = 'editing');--> statement-breakpoint
CREATE POLICY "team_update" ON "prepared_scripts" AS PERMISSIVE FOR UPDATE TO public USING ("prepared_scripts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "prepared_scripts"."state" <> 'matched') WITH CHECK ("prepared_scripts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "prepared_scripts"."updated_by" = nullif(current_setting('app.user_id', true), '') and "prepared_scripts"."state" <> 'matched');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "prepared_scripts" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Scripts in preparation (ADR 0112 §§ 20-23): written by the owner and the active managers under her RLS, closed to her
-- account, never deleted; read by the jobs as the service role, which marks one matched when an import recognises it.
ALTER TABLE "prepared_scripts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app reads, writes and saves; it never deletes.
REVOKE ALL ON "prepared_scripts" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "prepared_scripts" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON "prepared_scripts" TO impera_service;
