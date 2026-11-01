-- The end « upheld » of a contest (EQ-06 lot 6, ADR 0039 § 3 to 5): `contest_upheld` replaces `credited` in the event
-- kinds, the reasons required, the policy `owner_step`, the unique index of a contest's end and the trigger
-- `keep_invoice_event`. No row carries `credited`: nothing is deployed, and no code ever wrote it (ADR 0039 § 4).
-- An upheld contest is corrected by pay alone, never by a credit note written by hand: `pay_adjustments` names the
-- document whose contest it corrects (`contested_invoice_id`), checked at the insert (`keep_contest_correction`: of
-- the document's member, correcting the document's period), and tied to `contest_upheld` both ways at the commit, in
-- one transaction (`check_contest_upheld_at_commit`, `check_contest_correction_at_commit`).
ALTER TABLE "invoice_events" DROP CONSTRAINT "invoice_events_kind_check";--> statement-breakpoint
ALTER TABLE "invoice_events" DROP CONSTRAINT "invoice_events_values_check";--> statement-breakpoint
DROP INDEX "invoice_events_contest_end_unique";--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD COLUMN "contested_invoice_id" uuid;--> statement-breakpoint
CREATE INDEX "pay_adjustments_contested_idx" ON "pay_adjustments" USING btree ("contested_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_events_contest_end_unique" ON "invoice_events" USING btree ("invoice_id") WHERE "invoice_events"."kind" in ('contest_upheld', 'contest_refused');--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_kind_check" CHECK ("invoice_events"."kind" in ('issued', 'accepted', 'contested', 'lapsed', 'contest_upheld', 'contest_refused', 'paid'));--> statement-breakpoint
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_values_check" CHECK (("invoice_events"."kind" = 'paid') = ("invoice_events"."statement_id" is not null) and ("invoice_events"."reason" is null or char_length("invoice_events"."reason") between 1 and 500) and ("invoice_events"."kind" not in ('contested', 'contest_upheld', 'contest_refused') or "invoice_events"."reason" is not null));--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_contest_check" CHECK ("pay_adjustments"."contested_invoice_id" is null or "pay_adjustments"."corrects_statement_id" is not null);--> statement-breakpoint
ALTER POLICY "owner_step" ON "invoice_events" TO public WITH CHECK ("invoice_events"."kind" in ('issued', 'contest_upheld', 'contest_refused', 'paid') and "invoice_events"."by" = nullif(current_setting('app.user_id', true), '') and exists (select 1 from invoices i where i.id = "invoice_events"."invoice_id" and nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = i.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- The foreign key is written here: `invoices.ts` imports the schema of `pay_adjustments`, which keeps no cycle.
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_contested_invoice_id_invoices_id_fk"
  FOREIGN KEY ("contested_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- As in 0041, with `contest_upheld` in place of `credited`: a contest ends upheld or refused, once, whether the
-- document is an invoice or a credit note (ADR 0039 § 5: a credit note contested has the same two ends).
CREATE OR REPLACE FUNCTION "keep_invoice_event"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  invoice "invoices"%ROWTYPE;
  contested_at timestamptz;
BEGIN
  SELECT * INTO invoice FROM "invoices" i WHERE i."id" = NEW."invoice_id";
  -- An invoice its author cannot read is the policy's to refuse, a missing one the foreign key's.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT e."created_at" INTO contested_at FROM "invoice_events" e
  WHERE e."invoice_id" = NEW."invoice_id" AND e."kind" = 'contested';
  -- In parentheses: PL/pgSQL would end the condition at the first THEN of the CASE.
  IF (CASE NEW."kind"
    WHEN 'issued' THEN invoice."created_at" = now()
    WHEN 'accepted' THEN now() < invoice."acceptance_deadline"
    WHEN 'contested' THEN now() < invoice."acceptance_deadline"
    WHEN 'lapsed' THEN now() >= invoice."acceptance_deadline"
    WHEN 'contest_upheld' THEN contested_at IS NOT NULL
    WHEN 'contest_refused' THEN contested_at IS NOT NULL
    WHEN 'paid' THEN invoice."kind" = 'invoice' AND EXISTS (
      SELECT 1 FROM "commission_statements" s
      WHERE s."id" = NEW."statement_id" AND s."member_id" = invoice."member_id" AND s."status" = 'paid'
        AND s."period" >= invoice."period")
  END) IS NOT TRUE THEN
    RAISE EXCEPTION 'event % does not follow where invoice % stands (EQ-06)', NEW."kind", invoice."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- An adjustment that corrects a contest is of the document's member and corrects the document's period: an
-- invoice's own statement, or for a credit note the statement of the invoice it cites (ADR 0039 § 3). A document its
-- writer cannot read is refused here: no policy of `pay_adjustments` looks at it.
CREATE FUNCTION "keep_contest_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  document "invoices"%ROWTYPE;
  known boolean;
  corrected uuid;
BEGIN
  IF NEW."contested_invoice_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO document FROM "invoices" i WHERE i."id" = NEW."contested_invoice_id";
  known := FOUND;
  IF known THEN
    corrected := CASE document."kind"
      WHEN 'invoice' THEN document."statement_id"
      ELSE (SELECT c."statement_id" FROM "invoices" c WHERE c."id" = document."credited_invoice_id")
    END;
  END IF;
  IF NOT known OR document."member_id" <> NEW."member_id" OR corrected IS DISTINCT FROM NEW."corrects_statement_id" THEN
    RAISE EXCEPTION 'an adjustment corrects a contested document of its member, and that document''s period (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_adjustments_contest_correction" BEFORE INSERT ON "pay_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "keep_contest_correction"();--> statement-breakpoint
-- At the commit, both ways (ADR 0039 § 3): a contest upheld has an adjustment that names its document, written in its
-- transaction (`now()` is the transaction's instant, as for `keep_invoice_line`); an adjustment that names a document
-- has that document's `contest_upheld` in its transaction. One end of a contest at most (the unique index), so no
-- adjustment can name the document after the transaction that upheld it.
CREATE FUNCTION "check_contest_upheld_at_commit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pay_adjustments" a WHERE a."contested_invoice_id" = NEW."invoice_id" AND a."created_at" = now()
  ) THEN
    RAISE EXCEPTION 'a contest upheld is corrected by pay in its transaction (EQ-06, ADR 0039)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "invoice_events_upheld_at_commit" AFTER INSERT ON "invoice_events"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."kind" = 'contest_upheld')
  EXECUTE FUNCTION "check_contest_upheld_at_commit"();--> statement-breakpoint
CREATE FUNCTION "check_contest_correction_at_commit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "invoice_events" e
    WHERE e."invoice_id" = NEW."contested_invoice_id" AND e."kind" = 'contest_upheld' AND e."created_at" = now()
  ) THEN
    RAISE EXCEPTION 'an adjustment names a contested document only with its contest upheld (EQ-06, ADR 0039)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "pay_adjustments_correction_at_commit" AFTER INSERT ON "pay_adjustments"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."contested_invoice_id" IS NOT NULL)
  EXECUTE FUNCTION "check_contest_correction_at_commit"();
