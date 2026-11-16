CREATE TABLE "script_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_script_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"schema_version" smallint NOT NULL,
	"content" jsonb NOT NULL,
	"author" text NOT NULL,
	"model" text,
	"prompt_hash" text,
	"validated_by" text,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_identities_validated_check" CHECK (("script_identities"."validated_by" is null) = ("script_identities"."validated_at" is null)),
	CONSTRAINT "script_identities_input_hash_check" CHECK ("script_identities"."input_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "script_identities_content_check" CHECK (jsonb_typeof("script_identities"."content") = 'object'),
	CONSTRAINT "script_identities_schema_version_check" CHECK ("script_identities"."schema_version" >= 1),
	CONSTRAINT "script_identities_author_check" CHECK ("script_identities"."author" in ('brain', 'human')),
	CONSTRAINT "script_identities_writer_check" CHECK (case "script_identities"."author" when 'brain' then "script_identities"."model" is not null and "script_identities"."prompt_hash" is not null else "script_identities"."validated_at" is not null and "script_identities"."model" is null and "script_identities"."prompt_hash" is null end)
);
--> statement-breakpoint
ALTER TABLE "script_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The platform's own rank of each step (SC-04 c8): a step imported before it had none, its position stands for it until
-- the next import, which rewrites the script (its fingerprint now holds the rank).
ALTER TABLE "platform_script_steps" ADD COLUMN "platform_index" integer;--> statement-breakpoint
UPDATE "platform_script_steps" SET "platform_index" = "position";--> statement-breakpoint
ALTER TABLE "platform_script_steps" ALTER COLUMN "platform_index" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "script_identities" ADD CONSTRAINT "script_identities_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_identities" ADD CONSTRAINT "script_identities_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_identities" ADD CONSTRAINT "script_identities_script_creator_fk" FOREIGN KEY ("platform_script_id","creator_id") REFERENCES "public"."platform_scripts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_identities_brain_unique" ON "script_identities" USING btree ("platform_script_id","input_hash","prompt_hash") WHERE "script_identities"."author" = 'brain';--> statement-breakpoint
CREATE INDEX "script_identities_script_idx" ON "script_identities" USING btree ("creator_id","platform_script_id");--> statement-breakpoint
ALTER TABLE "platform_script_steps" ADD CONSTRAINT "platform_script_steps_platform_index_check" CHECK ("platform_script_steps"."platform_index" >= 0);--> statement-breakpoint
CREATE POLICY "team_read" ON "script_identities" AS PERMISSIVE FOR SELECT TO public USING ("script_identities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "team_validate" ON "script_identities" AS PERMISSIVE FOR UPDATE TO public USING ("script_identities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')) WITH CHECK ("script_identities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "script_identities"."validated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_correct" ON "script_identities" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("script_identities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "script_identities"."author" = 'human' and "script_identities"."validated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "script_identities" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- A native script's identity (SC-04 lot c8): read and validated by the owner and the active managers under her RLS,
-- closed to her account; written by the brain's job as the service role (it holds BYPASSRLS), or by hand by the team.
ALTER TABLE "script_identities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app reads, writes a hand's row, and stamps a validation.
REVOKE ALL ON "script_identities" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "script_identities" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("validated_by", "validated_at") ON "script_identities" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "script_identities" TO impera_service;--> statement-breakpoint
-- Written once, then validated once, as the descriptions and the syntheses (ADR 0030 § 3, migration 0152).
CREATE TRIGGER "script_identities_kept" BEFORE UPDATE ON "script_identities" FOR EACH ROW
  EXECUTE FUNCTION "refuse_description_change"();
