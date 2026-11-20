CREATE TABLE "creator_revenue_objectives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"set_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_revenue_objectives_month_unique" UNIQUE("creator_id","month"),
	CONSTRAINT "creator_revenue_objectives_month_check" CHECK (extract(day from "creator_revenue_objectives"."month") = 1),
	CONSTRAINT "creator_revenue_objectives_amount_check" CHECK ("creator_revenue_objectives"."amount_minor" between 1 and 100000000)
);
--> statement-breakpoint
ALTER TABLE "creator_revenue_objectives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_revenue_objectives" ADD CONSTRAINT "creator_revenue_objectives_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_revenue_objectives" ADD CONSTRAINT "creator_revenue_objectives_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_revenue_objectives" AS PERMISSIVE FOR SELECT TO public USING ("creator_revenue_objectives"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "creator_revenue_objectives" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("creator_revenue_objectives"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_revenue_objectives"."set_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "creator_revenue_objectives" AS PERMISSIVE FOR UPDATE TO public USING ("creator_revenue_objectives"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK ("creator_revenue_objectives"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_revenue_objectives"."set_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_delete" ON "creator_revenue_objectives" AS PERMISSIVE FOR DELETE TO public USING ("creator_revenue_objectives"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "creator_revenue_objectives" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Monthly revenue objectives (ADR 0092 § 6): set by the owner alone under her RLS, read by the owner and the active
-- managers, closed to her account. No job reads them and they never reach the MCP: the service role gets nothing (a
-- migration that needs it opens it).
ALTER TABLE "creator_revenue_objectives" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave.
REVOKE ALL ON "creator_revenue_objectives" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "creator_revenue_objectives" TO nirvana_app;
