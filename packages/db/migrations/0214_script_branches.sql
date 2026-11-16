CREATE TABLE "platform_script_branches" (
	"platform_script_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_step_ref" text NOT NULL,
	"branch_order" smallint NOT NULL,
	"condition" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_script_branches_pkey" PRIMARY KEY("platform_script_id","platform_step_ref"),
	CONSTRAINT "platform_script_branches_order_check" CHECK ("platform_script_branches"."branch_order" >= 0 and "platform_script_branches"."branch_order" < 50),
	CONSTRAINT "platform_script_branches_ref_check" CHECK (char_length("platform_script_branches"."platform_step_ref") <= 200),
	CONSTRAINT "platform_script_branches_condition_check" CHECK (jsonb_typeof("platform_script_branches"."condition") = 'object' and "platform_script_branches"."condition"->>'kind' in ('none', 'structured', 'text'))
);
--> statement-breakpoint
ALTER TABLE "platform_script_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_script_branches" ADD CONSTRAINT "platform_script_branches_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_script_branches" ADD CONSTRAINT "platform_script_branches_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_script_branches" ADD CONSTRAINT "platform_script_branches_script_creator_fk" FOREIGN KEY ("platform_script_id","creator_id") REFERENCES "public"."platform_scripts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_script_branches_creator_idx" ON "platform_script_branches" USING btree ("creator_id","platform_script_id");--> statement-breakpoint
CREATE POLICY "team_read" ON "platform_script_branches" AS PERMISSIVE FOR SELECT TO public USING ("platform_script_branches"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "team_write" ON "platform_script_branches" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("platform_script_branches"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "platform_script_branches"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_clear" ON "platform_script_branches" AS PERMISSIVE FOR DELETE TO public USING ("platform_script_branches"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "platform_script_branches" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- What Impera holds of a branch that Reveal does not give (ADR 0112 § A 3): set a whole step at a time by the owner and
-- the active managers under her RLS, closed to her account; read by the jobs as the service role.
ALTER TABLE "platform_script_branches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app reads, clears and writes a step's branches.
REVOKE ALL ON "platform_script_branches" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "platform_script_branches" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "platform_script_branches" TO impera_service;
