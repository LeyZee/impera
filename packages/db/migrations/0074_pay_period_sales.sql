-- The registry of counted sales and the base of a statement's line (CRM-03 lot b2, ADR 0050 §§ 5, 7 and 8, ADR 0032).
-- Every line written before keeps its content: `base` defaults to `gross_chain` and `sales` to an empty array, which
-- the unique key of a line now names, so that one account may have a line of each base. No row is rewritten.
CREATE TABLE "pay_period_sales" (
	"platform" text NOT NULL,
	"platform_sale_id" text NOT NULL,
	"event" text NOT NULL,
	"period" date NOT NULL,
	"member_id" uuid NOT NULL,
	"link_version" text NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"net_minor" integer NOT NULL,
	"sale_period" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_period_sales_pkey" PRIMARY KEY("platform","platform_sale_id","event"),
	CONSTRAINT "pay_period_sales_platform_check" CHECK ("pay_period_sales"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "pay_period_sales_event_check" CHECK ("pay_period_sales"."event" in ('sale', 'refund')),
	CONSTRAINT "pay_period_sales_currency_check" CHECK ("pay_period_sales"."currency" in ('EUR', 'USD')),
	CONSTRAINT "pay_period_sales_sale_period_check" CHECK (extract(day from "pay_period_sales"."sale_period") in (1, 16)),
	CONSTRAINT "pay_period_sales_net_check" CHECK ("pay_period_sales"."sale_period" <= "pay_period_sales"."period" and (("pay_period_sales"."event" = 'sale' and "pay_period_sales"."net_minor" >= 0) or ("pay_period_sales"."event" = 'refund' and "pay_period_sales"."net_minor" <= 0)))
);
--> statement-breakpoint
ALTER TABLE "pay_period_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" DROP CONSTRAINT "commission_statement_lines_rules_unique";--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD COLUMN "base" text DEFAULT 'gross_chain' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD COLUMN "sales" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD CONSTRAINT "pay_period_sales_period_pay_period_closings_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_period_closings"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD CONSTRAINT "pay_period_sales_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD CONSTRAINT "pay_period_sales_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_period_sales_period_member_idx" ON "pay_period_sales" USING btree ("period","member_id");--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_rules_unique" UNIQUE("statement_id","revision","platform_account_id","currency","vat_bps","platform_fee_bps","base");--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_base_check" CHECK ("commission_statement_lines"."base" in ('platform_net', 'gross_chain'));--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_sales_check" CHECK (jsonb_typeof("commission_statement_lines"."sales") = 'array' and ("commission_statement_lines"."base" = 'platform_net' or "commission_statement_lines"."sales" = '[]'::jsonb) and ("commission_statement_lines"."base" = 'gross_chain' or ("commission_statement_lines"."vat_bps" = 0 and "commission_statement_lines"."platform_fee_bps" = 0 and cardinality("commission_statement_lines"."shift_report_ids") = 0 and "commission_statement_lines"."late_reports" = '[]'::jsonb)));--> statement-breakpoint
CREATE POLICY "member_read" ON "pay_period_sales" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "pay_period_sales"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "pay_period_sales" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
-- Written by hand (CRM-03 lot b2). Drizzle does not write what follows.
ALTER TABLE "pay_period_sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Added only, for every role (`refuse_pay_change` of 0026): a sale a closing counted never changes.
CREATE TRIGGER "pay_period_sales_append_only" BEFORE UPDATE OR DELETE ON "pay_period_sales"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- A sale is counted by the closing written in this very transaction (its row's `xmin`, as a report in 0029), and is
-- the line of the platform's register it names, with its account, its currency and its net (a refund's taken off,
-- so negative). Read under the policies of whoever writes: the line's creator is the one entered.
CREATE FUNCTION "keep_counted_sale"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pay_period_closings" c
    WHERE c."period" = NEW."period" AND c."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'a sale is counted by the closing of its own transaction (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "platform_sales" l
    WHERE l."platform" = NEW."platform" AND l."platform_sale_id" = NEW."platform_sale_id" AND l."event" = NEW."event"
      AND l."platform_account_id" = NEW."platform_account_id" AND l."currency" = NEW."currency"
      AND CASE WHEN l."event" = 'refund' THEN -l."net_minor" ELSE l."net_minor" END = NEW."net_minor"
  ) THEN
    RAISE EXCEPTION 'a counted sale is a line of the register, with its account, currency and net (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_period_sales_counted" BEFORE INSERT ON "pay_period_sales"
  FOR EACH ROW EXECUTE FUNCTION "keep_counted_sale"();--> statement-breakpoint
-- 0031's statement guard, and one more rule for a validation (CRM-03): the statement carries exactly the sales the
-- registry counted for its member in the period, with their net and the link's version, as it carries the reports.
-- A statement computed before the closing that counts a sale gone to the next period would otherwise pay it twice.
CREATE OR REPLACE FUNCTION "keep_commission_statement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- What paying a validated statement writes.
  paying CONSTANT text[] := ARRAY['status', 'paid_at', 'paid_by', 'paid_on', 'payment_method', 'payment_reference',
    'sent_minor'];
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
    ) OR (
      SELECT coalesce(array_agg(k.counted ORDER BY k.counted), '{}'::text[])
      FROM "commission_statement_lines" l, jsonb_array_elements(l."sales") AS e,
        LATERAL (SELECT concat_ws(' ', e ->> 'platform', e ->> 'platformSaleId', e ->> 'event', e ->> 'netMinor',
          e ->> 'linkVersion') AS counted) k
      WHERE l."statement_id" = NEW."id" AND l."revision" = NEW."revision"
    ) IS DISTINCT FROM (
      SELECT coalesce(array_agg(k.counted ORDER BY k.counted), '{}'::text[])
      FROM "pay_period_sales" r,
        LATERAL (SELECT concat_ws(' ', r."platform", r."platform_sale_id", r."event", r."net_minor"::text,
          r."link_version") AS counted) k
      WHERE r."period" = NEW."period" AND r."member_id" = NEW."member_id"
    ) THEN
      RAISE EXCEPTION 'statement % does not carry the closing of its period: compute it again (ADR 0032)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD."status" = 'validated' AND NEW."status" = 'paid' THEN
    IF to_jsonb(NEW) - paying IS DISTINCT FROM to_jsonb(OLD) - paying THEN
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
-- From nothing, whatever the default privileges of the base gave. The validation that closes a period writes it.
REVOKE ALL ON "pay_period_sales" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pay_period_sales" TO nirvana_app;
