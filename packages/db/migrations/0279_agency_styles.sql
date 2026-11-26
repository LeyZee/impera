CREATE TABLE "agency_styles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"private_style" text NOT NULL,
	"public_style" text NOT NULL,
	"form" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_by" text,
	"activated_at" timestamp with time zone,
	CONSTRAINT "agency_styles_version_check" CHECK ("agency_styles"."version" > 0),
	CONSTRAINT "agency_styles_private_style_check" CHECK (char_length("agency_styles"."private_style") <= 8000),
	CONSTRAINT "agency_styles_public_style_check" CHECK (char_length("agency_styles"."public_style") <= 4000),
	CONSTRAINT "agency_styles_form_check" CHECK (jsonb_typeof("agency_styles"."form") = 'object'),
	CONSTRAINT "agency_styles_activated_check" CHECK (not "agency_styles"."is_active" or ("agency_styles"."activated_at" is not null and "agency_styles"."activated_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "agency_styles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_styles" ADD CONSTRAINT "agency_styles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_styles" ADD CONSTRAINT "agency_styles_activated_by_user_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_styles_version_unique" ON "agency_styles" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_styles_one_active" ON "agency_styles" USING btree ("is_active") WHERE "agency_styles"."is_active";--> statement-breakpoint
CREATE POLICY "owner_read" ON "agency_styles" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "owner_insert" ON "agency_styles" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "agency_styles"."created_by" = nullif(current_setting('app.user_id', true), '') and not "agency_styles"."is_active");--> statement-breakpoint
CREATE POLICY "owner_activate" ON "agency_styles" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and (not "agency_styles"."is_active" or "agency_styles"."activated_by" = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "agency_styles" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Style de base de l'agence (ADR 0171): the owner's alone. Forced, so that even the table's owner goes through RLS.
ALTER TABLE "agency_styles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app reads and adds versions, sets only the activation,
-- deletes none; the service role reads the active one for the agent.
REVOKE ALL ON "agency_styles" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "agency_styles" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("is_active", "activated_by", "activated_at") ON "agency_styles" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "agency_styles" TO impera_service;
