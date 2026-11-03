CREATE TABLE "creator_agency_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"from_day" date NOT NULL,
	"agency_bps" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_agency_rates_creator_day_unique" UNIQUE("creator_id","from_day"),
	CONSTRAINT "creator_agency_rates_bps_check" CHECK ("creator_agency_rates"."agency_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "creator_agency_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_agency_rates" ADD CONSTRAINT "creator_agency_rates_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_agency_rates" ADD CONSTRAINT "creator_agency_rates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "owner_read" ON "creator_agency_rates" AS PERMISSIVE FOR SELECT TO public USING ("creator_agency_rates"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "owner_insert" ON "creator_agency_rates" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("creator_agency_rates"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_agency_rates"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
-- Written by hand (CR-04). Drizzle does not write what follows.
ALTER TABLE "creator_agency_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A creator's agency percentage is added only, for every role, the admin's included (ADR 0042 § 6: dated, never
-- applied backwards): a mistake is put right by the next percentage.
CREATE FUNCTION "refuse_agency_rate_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'this change to % is refused: an agency percentage is added only (CR-04)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "creator_agency_rates_append_only" BEFORE UPDATE OR DELETE ON "creator_agency_rates"
  FOR EACH ROW EXECUTE FUNCTION "refuse_agency_rate_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the trigger).
REVOKE ALL ON "creator_agency_rates" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_agency_rates" TO nirvana_app;
