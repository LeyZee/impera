CREATE TABLE "platform_script_step_media" (
	"platform_script_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"role" text NOT NULL,
	"rank" smallint NOT NULL,
	"platform_media_ref" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "platform_script_step_media_pkey" PRIMARY KEY("platform_script_id","position","role","rank"),
	CONSTRAINT "platform_script_step_media_rank_check" CHECK ("platform_script_step_media"."rank" >= 0 and "platform_script_step_media"."rank" < 50),
	CONSTRAINT "platform_script_step_media_ref_check" CHECK (char_length("platform_script_step_media"."platform_media_ref") <= 200),
	CONSTRAINT "platform_script_step_media_role_check" CHECK ("platform_script_step_media"."role" in ('sold', 'preview')),
	CONSTRAINT "platform_script_step_media_kind_check" CHECK ("platform_script_step_media"."kind" in ('image', 'video', 'audio'))
);
--> statement-breakpoint
ALTER TABLE "platform_script_step_media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_script_steps" (
	"platform_script_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"platform_step_ref" text NOT NULL,
	"name" text NOT NULL,
	"text" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "platform_script_steps_pkey" PRIMARY KEY("platform_script_id","position"),
	CONSTRAINT "platform_script_steps_position_check" CHECK ("platform_script_steps"."position" >= 0 and "platform_script_steps"."position" < 50),
	CONSTRAINT "platform_script_steps_text_check" CHECK (char_length("platform_script_steps"."name") <= 200 and char_length("platform_script_steps"."text") <= 4000 and char_length("platform_script_steps"."platform_step_ref") <= 200),
	CONSTRAINT "platform_script_steps_price_check" CHECK ("platform_script_steps"."price_minor" >= 0),
	CONSTRAINT "platform_script_steps_currency_check" CHECK ("platform_script_steps"."currency" in ('EUR', 'USD'))
);
--> statement-breakpoint
ALTER TABLE "platform_script_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_scripts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"platform_script_ref" text NOT NULL,
	"name" text NOT NULL,
	"moment" text,
	"fingerprint" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp with time zone,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_scripts_account_ref_unique" UNIQUE("platform_account_id","platform_script_ref"),
	CONSTRAINT "platform_scripts_id_creator_unique" UNIQUE("id","creator_id"),
	CONSTRAINT "platform_scripts_moment_check" CHECK ("platform_scripts"."moment" in ('day', 'night')),
	CONSTRAINT "platform_scripts_active_check" CHECK ("platform_scripts"."active" = ("platform_scripts"."deactivated_at" is null)),
	CONSTRAINT "platform_scripts_text_check" CHECK (char_length("platform_scripts"."name") <= 200 and char_length("platform_scripts"."platform_script_ref") <= 200)
);
--> statement-breakpoint
ALTER TABLE "platform_scripts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_script_step_media" ADD CONSTRAINT "platform_script_step_media_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_script_step_media" ADD CONSTRAINT "platform_script_step_media_script_creator_fk" FOREIGN KEY ("platform_script_id","creator_id") REFERENCES "public"."platform_scripts"("id","creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_script_step_media" ADD CONSTRAINT "platform_script_step_media_step_fk" FOREIGN KEY ("platform_script_id","position") REFERENCES "public"."platform_script_steps"("platform_script_id","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_script_steps" ADD CONSTRAINT "platform_script_steps_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_script_steps" ADD CONSTRAINT "platform_script_steps_script_creator_fk" FOREIGN KEY ("platform_script_id","creator_id") REFERENCES "public"."platform_scripts"("id","creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_scripts" ADD CONSTRAINT "platform_scripts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_scripts" ADD CONSTRAINT "platform_scripts_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_script_step_media_creator_media_idx" ON "platform_script_step_media" USING btree ("creator_id","platform_media_ref");--> statement-breakpoint
CREATE INDEX "platform_script_steps_creator_step_idx" ON "platform_script_steps" USING btree ("creator_id","platform_step_ref");--> statement-breakpoint
CREATE INDEX "platform_scripts_creator_idx" ON "platform_scripts" USING btree ("creator_id");--> statement-breakpoint
CREATE POLICY "team_read" ON "platform_script_step_media" AS PERMISSIVE FOR SELECT TO public USING ("platform_script_step_media"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "platform_script_step_media" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "team_read" ON "platform_script_steps" AS PERMISSIVE FOR SELECT TO public USING ("platform_script_steps"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "platform_script_steps" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "team_read" ON "platform_scripts" AS PERMISSIVE FOR SELECT TO public USING ("platform_scripts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "platform_scripts" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- The native scripts of each account (ADR 0099 § 1 time 2): read by the owner and the active managers under her RLS,
-- closed to her account; written by the import job alone, as the service role (it holds BYPASSRLS).
ALTER TABLE "platform_scripts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_script_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_script_step_media" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app only reads (a TRUNCATE would pass the RLS).
REVOKE ALL ON "platform_scripts", "platform_script_steps", "platform_script_step_media" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "platform_scripts", "platform_script_steps", "platform_script_step_media" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "platform_scripts" TO impera_service;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "platform_script_steps", "platform_script_step_media" TO impera_service;
