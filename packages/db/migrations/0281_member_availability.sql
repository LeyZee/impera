CREATE TABLE "member_availability_weeks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"time_zone" text NOT NULL,
	"ranges" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_availability_weeks_ranges_check" CHECK (jsonb_typeof("member_availability_weeks"."ranges") = 'array' and jsonb_array_length("member_availability_weeks"."ranges") <= 21),
	CONSTRAINT "member_availability_weeks_zone_check" CHECK (char_length("member_availability_weeks"."time_zone") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "member_availability_weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_availability_weeks" ADD CONSTRAINT "member_availability_weeks_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_availability_weeks" ADD CONSTRAINT "member_availability_weeks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_availability_weeks_member_idx" ON "member_availability_weeks" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE POLICY "member_read" ON "member_availability_weeks" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "member_availability_weeks"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_insert" ON "member_availability_weeks" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("member_availability_weeks"."created_by" = nullif(current_setting('app.user_id', true), '') and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "member_availability_weeks"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- Written by hand (ADR 0171, trou 16). Drizzle does not write what follows.
ALTER TABLE "member_availability_weeks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Added only, for every role (`refuse_change` of 0000): a week set stays, the next one replaces it.
CREATE TRIGGER "member_availability_weeks_append_only" BEFORE UPDATE OR DELETE ON "member_availability_weeks"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave.
REVOKE ALL ON "member_availability_weeks" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "member_availability_weeks" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "member_availability_weeks" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "member_availability_weeks" TO impera_service;
