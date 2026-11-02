-- The reconciliation of transfers with documents (EQ-06 lot 7a; ADR 0023 § Factures, ADR 0036, ADR 0038). A document is
-- settled once, in full, by the first statement its carry-overs lead to that ends its debt: `paid` (an invoice) or
-- `imputed` (a credit note) by a paid statement, `compensated` at a validated one whose cumulated total is zero, or
-- below zero for an invoice (art. 1347 du Code civil). The job writes it alone: the owner no longer records `paid`
-- (`owner_step`), no row carries `paid` (nothing is deployed, and no code ever wrote it), and one settled kind per
-- document replaces one `paid` per statement. `keep_invoice_event` walks the carry-overs to check the statement.
ALTER TABLE "invoice_events" DROP CONSTRAINT "invoice_events_kind_check";--> statement-breakpoint
ALTER TABLE "invoice_events" DROP CONSTRAINT "invoice_events_values_check";--> statement-breakpoint
DROP INDEX "invoice_events_paid_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_settled_unique" ON "invoice_events" USING btree ("invoice_id") WHERE "invoice_events"."kind" in ('paid', 'imputed', 'compensated');--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_kind_check" CHECK ("invoice_events"."kind" in ('issued', 'accepted', 'contested', 'lapsed', 'contest_upheld', 'contest_refused', 'paid', 'imputed', 'compensated'));--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_values_check" CHECK (("invoice_events"."kind" in ('paid', 'imputed', 'compensated')) = ("invoice_events"."statement_id" is not null) and ("invoice_events"."reason" is null or char_length("invoice_events"."reason") between 1 and 500) and ("invoice_events"."kind" not in ('contested', 'contest_upheld', 'contest_refused') or "invoice_events"."reason" is not null));--> statement-breakpoint
ALTER POLICY "owner_step" ON "invoice_events" TO public WITH CHECK ("invoice_events"."kind" in ('issued', 'contest_upheld', 'contest_refused') and "invoice_events"."by" = nullif(current_setting('app.user_id', true), '') and exists (select 1 from invoices i where i.id = "invoice_events"."invoice_id" and nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = i.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- As in 0050, with the three settlements in place of `paid`. The walk starts at the document's statement and follows
-- each carry-over to the member's statement of the period it goes to; the first statement that ends the debt is the
-- only one that may settle it, by the job (`by` is null), once (the unique index).
CREATE OR REPLACE FUNCTION "keep_invoice_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice "invoices"%ROWTYPE;
  contested_at timestamptz;
  settler uuid;
  settler_status text;
BEGIN
  SELECT * INTO invoice FROM "invoices" i WHERE i."id" = NEW."invoice_id";
  -- An invoice its author cannot read is the policy's to refuse, a missing one the foreign key's.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT e."created_at" INTO contested_at FROM "invoice_events" e
  WHERE e."invoice_id" = NEW."invoice_id" AND e."kind" = 'contested';
  IF NEW."kind" IN ('paid', 'imputed', 'compensated') THEN
    SELECT w."id", w."status" INTO settler, settler_status FROM (
      WITH RECURSIVE "walk"("id", "status", "total_minor", "depth") AS (
        SELECT s."id", s."status", s."total_minor", 0 FROM "commission_statements" s
        WHERE s."id" = invoice."statement_id" AND s."member_id" = invoice."member_id"
        UNION ALL
        SELECT n."id", n."status", n."total_minor", w."depth" + 1 FROM "walk" w
        JOIN "carry_overs" c ON c."statement_id" = w."id"
        JOIN "commission_statements" n ON n."member_id" = invoice."member_id" AND n."period" = c."to_period"
      )
      SELECT * FROM "walk"
    ) w
    WHERE w."status" = 'paid'
      OR (w."status" = 'validated' AND (w."total_minor" = 0 OR (invoice."kind" = 'invoice' AND w."total_minor" < 0)))
    ORDER BY w."depth"
    LIMIT 1;
  END IF;
  -- In parentheses: PL/pgSQL would end the condition at the first THEN of the CASE.
  IF (CASE NEW."kind"
    WHEN 'issued' THEN invoice."created_at" = now()
    WHEN 'accepted' THEN now() < invoice."acceptance_deadline"
    WHEN 'contested' THEN now() < invoice."acceptance_deadline"
    WHEN 'lapsed' THEN now() >= invoice."acceptance_deadline"
    WHEN 'contest_upheld' THEN contested_at IS NOT NULL
    WHEN 'contest_refused' THEN contested_at IS NOT NULL
    WHEN 'paid' THEN invoice."kind" = 'invoice' AND NEW."by" IS NULL
      AND settler = NEW."statement_id" AND settler_status = 'paid'
    WHEN 'imputed' THEN invoice."kind" = 'credit_note' AND NEW."by" IS NULL
      AND settler = NEW."statement_id" AND settler_status = 'paid'
    WHEN 'compensated' THEN NEW."by" IS NULL AND settler = NEW."statement_id" AND settler_status = 'validated'
  END) IS NOT TRUE THEN
    RAISE EXCEPTION 'event % does not follow where invoice % stands (EQ-06)', NEW."kind", invoice."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
