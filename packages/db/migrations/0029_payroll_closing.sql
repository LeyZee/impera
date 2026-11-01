CREATE TABLE "pay_period_closings" (
	"period" date PRIMARY KEY NOT NULL,
	"team_net_minor" bigint NOT NULL,
	"collective" jsonb,
	"exchange_rates" jsonb NOT NULL,
	"closed_by" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_period_closings_period_check" CHECK (extract(day from "pay_period_closings"."period") in (1, 16)),
	CONSTRAINT "pay_period_closings_rates_check" CHECK (jsonb_typeof("pay_period_closings"."exchange_rates") = 'array')
);
--> statement-breakpoint
ALTER TABLE "pay_period_closings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_period_reports" (
	"shift_report_id" uuid PRIMARY KEY NOT NULL,
	"period" date NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_period_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_period_closings" ADD CONSTRAINT "pay_period_closings_period_pay_periods_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_periods"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_closings" ADD CONSTRAINT "pay_period_closings_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_reports" ADD CONSTRAINT "pay_period_reports_shift_report_id_shift_reports_id_fk" FOREIGN KEY ("shift_report_id") REFERENCES "public"."shift_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_reports" ADD CONSTRAINT "pay_period_reports_period_pay_period_closings_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_period_closings"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_reports" ADD CONSTRAINT "pay_period_reports_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_period_reports_period_member_idx" ON "pay_period_reports" USING btree ("period","member_id");--> statement-breakpoint
CREATE POLICY "team_read" ON "pay_period_closings" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "agency_insert" ON "pay_period_closings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "pay_period_closings"."closed_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "pay_period_reports" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "pay_period_reports"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "pay_period_reports" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
-- Written by hand (EQ-04, ADR 0032). Drizzle does not write what follows.
ALTER TABLE "pay_period_closings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_period_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Added only, for every role (`refuse_pay_change` of 0026): a closing and the reports it counted never change.
CREATE TRIGGER "pay_period_closings_append_only" BEFORE UPDATE OR DELETE ON "pay_period_closings"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "pay_period_reports_append_only" BEFORE UPDATE OR DELETE ON "pay_period_reports"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- A period closes for the team once it has ended, right after the last period closed: periods close in order, one by
-- one, an empty one too (the validation that skips it closes it first). The first closing is of the earliest period
-- that has a statement. It is closed now, whatever the writer said.
CREATE FUNCTION "keep_pay_period_closing"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_closed date;
BEGIN
  NEW."closed_at" := now();
  IF NOT EXISTS (SELECT 1 FROM "pay_periods" p WHERE p."period" = NEW."period" AND p."ends_at" <= now()) THEN
    RAISE EXCEPTION 'period % has not ended: it cannot close (ADR 0032)', NEW."period"
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT max(c."period") INTO last_closed FROM "pay_period_closings" c;
  IF last_closed IS NULL THEN
    IF EXISTS (SELECT 1 FROM "commission_statements" s WHERE s."period" < NEW."period") THEN
      RAISE EXCEPTION 'an earlier period has statements: periods close in order (ADR 0032)'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW."period" <> "next_pay_period"(last_closed) THEN
    RAISE EXCEPTION 'period % does not follow %: periods close in order (ADR 0032)', NEW."period", last_closed
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_period_closings_in_order" BEFORE INSERT ON "pay_period_closings"
  FOR EACH ROW EXECUTE FUNCTION "keep_pay_period_closing"();--> statement-breakpoint
-- A report is counted by the closing written in this very transaction (its row's `xmin`, outside any savepoint: a
-- savepoint gives the row its own id and is refused, never let through), once it is validated, for its own member,
-- in its period or a later one. Read under the policies of whoever writes: the report's creator is the one entered.
CREATE FUNCTION "keep_counted_report"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pay_period_closings" c
    WHERE c."period" = NEW."period" AND c."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'a report is counted by the closing of its own transaction (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "shift_reports" r
    WHERE r."id" = NEW."shift_report_id" AND r."status" = 'validated' AND r."member_id" = NEW."member_id"
      AND r."period" <= NEW."period"
  ) THEN
    RAISE EXCEPTION 'a counted report is validated, its member''s, and of this period or an earlier one (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_period_reports_counted" BEFORE INSERT ON "pay_period_reports"
  FOR EACH ROW EXECUTE FUNCTION "keep_counted_report"();--> statement-breakpoint
-- A member's period is closed too when it comes before the team's first closing: nothing is ever computed for it again
-- (a report of that time is late and goes to the first open period), so nothing lands on it.
CREATE OR REPLACE FUNCTION "pay_period_closed"(uuid, date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "commission_statements" s WHERE s."member_id" = $1 AND s."period" >= $2 AND s."status" <> 'draft'
  ) OR $2 < (SELECT min(c."period") FROM "pay_period_closings" c)
$$;--> statement-breakpoint
-- 0028's statement guard, and one more rule for a validation (ADR 0032): the statement carries its period's closing,
-- the same team net, collective goal as reached and rates, and exactly the reports the registry counted for its
-- member in the period. A statement computed before the closing that counts a report gone to the next period would
-- otherwise pay it twice.
CREATE OR REPLACE FUNCTION "keep_commission_statement"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' THEN
      RAISE EXCEPTION 'a statement is made a draft, and only a validation validates it (EQ-04)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF "pay_period_closed"(NEW."member_id", NEW."period") THEN
      RAISE EXCEPTION 'a draft for a period already validated: pay keeps its past (EQ-04)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'draft' AND NEW."status" = 'draft' THEN
    IF (NEW."id", NEW."member_id", NEW."period", NEW."created_at") IS DISTINCT FROM
       (OLD."id", OLD."member_id", OLD."period", OLD."created_at")
       OR NEW."revision" <> OLD."revision" + 1 THEN
      RAISE EXCEPTION 'a recalculation keeps statement % and takes its next revision (EQ-04)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD."status" = 'draft' AND NEW."status" = 'validated' THEN
    IF to_jsonb(NEW) - ARRAY['status', 'validated_at', 'validated_by']
       IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'validated_at', 'validated_by'] THEN
      RAISE EXCEPTION 'validating statement % changes nothing else (EQ-04)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "commission_statements" s
      WHERE s."member_id" = NEW."member_id" AND s."period" < NEW."period" AND s."status" = 'draft'
    ) THEN
      RAISE EXCEPTION 'an earlier statement of the member is still a draft: periods close in order (EQ-04)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "pay_period_closings" c
      WHERE c."period" = NEW."period" AND c."team_net_minor" = NEW."team_net_minor"
        AND c."collective" IS NOT DISTINCT FROM NEW."collective"
        AND c."exchange_rates" = NEW."rules" -> 'exchangeRates'
    ) OR (
      SELECT coalesce(array_agg(counted ORDER BY counted), '{}'::uuid[])
      FROM "commission_statement_lines" l, unnest(l."shift_report_ids") AS counted
      WHERE l."statement_id" = NEW."id" AND l."revision" = NEW."revision"
    ) IS DISTINCT FROM (
      SELECT coalesce(array_agg(r."shift_report_id" ORDER BY r."shift_report_id"), '{}'::uuid[])
      FROM "pay_period_reports" r
      WHERE r."period" = NEW."period" AND r."member_id" = NEW."member_id"
    ) THEN
      RAISE EXCEPTION 'statement % does not carry the closing of its period: compute it again (ADR 0032)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD."status" = 'validated' AND NEW."status" = 'paid' THEN
    IF to_jsonb(NEW) - ARRAY['status', 'paid_at', 'paid_by']
       IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'paid_at', 'paid_by'] THEN
      RAISE EXCEPTION 'paying statement % changes nothing else (EQ-04)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'statement % is % and stays so: pay keeps its past (EQ-04)', OLD."id", OLD."status"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave. The validation that closes a period writes both.
REVOKE ALL ON "pay_period_closings", "pay_period_reports" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pay_period_closings", "pay_period_reports" TO nirvana_app;
