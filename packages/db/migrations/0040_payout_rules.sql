-- PAIE-22 and PAIE-32 (accepted by Charles on 29/10). Additive. The payout minimum becomes dated, like the tiers: a new
-- one starts with a period that has not begun, so the drafts of a fortnight already worked keep theirs; the single
-- minimum of `payroll_settings` stays the one in force before any dated row. `payroll_settings` also keeps the payout
-- delay announced to the team, a setting, never a figure in the code.
CREATE TABLE "payout_minimums" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_period" date NOT NULL,
	"minimum_payout_minor" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_minimums_period_check" CHECK (extract(day from "payout_minimums"."from_period") in (1, 16)),
	CONSTRAINT "payout_minimums_minimum_check" CHECK ("payout_minimums"."minimum_payout_minor" between 0 and 5000000)
);
--> statement-breakpoint
ALTER TABLE "payout_minimums" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "payout_delay_business_days" smallint;--> statement-breakpoint
ALTER TABLE "payout_minimums" ADD CONSTRAINT "payout_minimums_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_minimums_period_idx" ON "payout_minimums" USING btree ("from_period");--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_payout_delay_check" CHECK ("payroll_settings"."payout_delay_business_days" is null or "payroll_settings"."payout_delay_business_days" between 1 and 30);--> statement-breakpoint
CREATE POLICY "team_read" ON "payout_minimums" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "payout_minimums" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "payout_minimums"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
-- Added by hand after `drizzle-kit generate`, as for the tiers (0028): forced RLS, added only for every role, never on a
-- period some statement is validated for, and the application role inserts and reads only.
ALTER TABLE "payout_minimums" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "payout_minimums_append_only" BEFORE UPDATE OR DELETE ON "payout_minimums"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE FUNCTION "refuse_settled_payout_minimum"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "pay_period_settled"(NEW."from_period") THEN
    RAISE EXCEPTION 'this payout minimum is for a period already validated: pay keeps its past (PAIE-22)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payout_minimums_open_period" BEFORE INSERT ON "payout_minimums"
  FOR EACH ROW EXECUTE FUNCTION "refuse_settled_payout_minimum"();--> statement-breakpoint
REVOKE ALL ON "payout_minimums" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "payout_minimums" TO nirvana_app;--> statement-breakpoint
-- The single minimum no longer changes from the application: a new one is a dated row. The delay is a setting.
REVOKE UPDATE ("minimum_payout_minor") ON "payroll_settings" FROM nirvana_app;--> statement-breakpoint
GRANT UPDATE ("payout_delay_business_days") ON "payroll_settings" TO nirvana_app;
