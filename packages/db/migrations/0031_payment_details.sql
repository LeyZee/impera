-- How a statement was paid (EQ-05, ADR 0023 § Factures). A database where lot 3c (#273) already paid a statement
-- refuses this migration: the CHECK wants the day, the method and the amount of every paid statement, which 3c never
-- recorded. Nothing is deployed and 3c was merged on 28/10/2026, so no real database holds one; a development
-- database that refuses 0031 is created again. No backfill: nobody knows the day nor the method of those payments.
ALTER TABLE "commission_statements" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "sent_minor" integer;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_payment_method_check" CHECK ("commission_statements"."payment_method" in ('bank_transfer', 'wise', 'paypal', 'other'));--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_payment_check" CHECK (("commission_statements"."status" = 'paid') = ("commission_statements"."paid_on" is not null) and ("commission_statements"."paid_on" is null) = ("commission_statements"."payment_method" is null) and ("commission_statements"."paid_on" is null) = ("commission_statements"."sent_minor" is null) and ("commission_statements"."payment_reference" is null or ("commission_statements"."paid_on" is not null and char_length("commission_statements"."payment_reference") between 1 and 100)) and ("commission_statements"."sent_minor" is null or "commission_statements"."sent_minor" between 1 and 5000000));--> statement-breakpoint
-- 0029's statement guard, the payment's details with it (ADR 0023 § Factures): paying a validated statement writes its
-- status, who paid and when, and how (the day of the transfer, the method, its reference, what was sent); nothing else.
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
-- The application writes the payment's details with the status, nothing more (0028 granted the status and who paid).
GRANT UPDATE ("paid_on", "payment_method", "payment_reference", "sent_minor") ON "commission_statements"
  TO nirvana_app;
