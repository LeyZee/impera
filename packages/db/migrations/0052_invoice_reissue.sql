-- ADR 0040 (erratum of ADR 0039 § 3): the cancel and reissue of an invoice bills it again on a corrective invoice of
-- its own, which keeps the period, the regime and the regime's mentions of the invoice it replaces, as a credit note
-- does (ADR 0036); a line of the period's invoice could only take the regime of the day. Both documents name the
-- invoice in `reissued_invoice_id`: the credit note that cancels all that is left of it, then the corrective invoice
-- of that very amount, numbered after it in the same transaction. A statement still bills its own period once
-- (`invoices_statement_unique`, now without its corrective invoices); an invoice is cancelled and billed again once
-- (`invoices_reissue_unique`). The two are written together or not at all, checked at the commit both ways
-- (`check_invoice_reissue_at_commit`). An adjustment that corrects a document corrects the statement of the
-- document's period, which for a corrective invoice is not the statement that issued it (`keep_contest_correction`).
DROP INDEX "invoices_statement_unique";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reissued_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reissued_invoice_id_invoices_id_fk" FOREIGN KEY ("reissued_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_reissue_unique" ON "invoices" USING btree ("reissued_invoice_id","kind") WHERE "invoices"."reissued_invoice_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_statement_unique" ON "invoices" USING btree ("statement_id") WHERE "invoices"."kind" = 'invoice' and "invoices"."reissued_invoice_id" is null;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reissue_check" CHECK ("invoices"."reissued_invoice_id" is null or "invoices"."kind" = 'invoice' or "invoices"."reissued_invoice_id" = "invoices"."credited_invoice_id");--> statement-breakpoint
-- 0041's function, with the corrective invoice: owed by a later statement, under the regime of the invoice it bills
-- again (never the regime of the day), after the cancel of that invoice in its transaction and of that cancel's amount;
-- and the cancel of a cancel and reissue, which takes off all that is left of its invoice.
CREATE OR REPLACE FUNCTION "keep_invoice"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cited "invoices"%ROWTYPE;
  cancel "invoices"%ROWTYPE;
BEGIN
  -- The instant of the transaction that issues it: its lines and its event `issued` are written in that one.
  NEW."created_at" := now();
  IF NOT EXISTS (
    SELECT 1 FROM "contractor_profiles" p WHERE p."member_id" = NEW."member_id" AND p."invoice_prefix" = NEW."prefix"
  ) OR NOT EXISTS (
    SELECT 1 FROM "invoice_counters" c
    WHERE c."member_id" = NEW."member_id" AND c."year" = NEW."year" AND c."last_sequence" = NEW."sequence"
  ) THEN
    RAISE EXCEPTION 'an invoice takes its contractor''s prefix and the number his counter holds (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."statement_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "commission_statements" s
    WHERE s."id" = NEW."statement_id" AND s."member_id" = NEW."member_id" AND s."status" IN ('validated', 'paid')
      AND CASE WHEN NEW."kind" = 'invoice' AND NEW."reissued_invoice_id" IS NULL THEN s."period" = NEW."period"
               ELSE s."period" > NEW."period" END
  ) THEN
    RAISE EXCEPTION 'an invoice bills a validated statement of its contractor and period; a credit note or a corrective invoice is owed by a later one (EQ-06, ADR 0040)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."kind" = 'invoice' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "billing_regime_validations" v
      WHERE v."regime_id" = NEW."regime_id" AND v."validated_on" <= NEW."issued_on"
    ) THEN
      RAISE EXCEPTION 'an invoice is issued under a regime the accountant validated by its day of issue (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."reissued_invoice_id" IS NULL THEN
      -- None assigned by that day: no regime, no invoice.
      IF NEW."regime_id" IS DISTINCT FROM (
        SELECT r."regime_id" FROM "contractor_regimes" r
        WHERE r."member_id" = NEW."member_id" AND r."effective_from" <= NEW."issued_on"
        ORDER BY r."effective_from" DESC
        LIMIT 1
      ) THEN
        RAISE EXCEPTION 'an invoice is issued under its contractor''s regime of its day of issue (EQ-06)'
          USING ERRCODE = 'restrict_violation';
      END IF;
    ELSE
      -- Under the lock its cancel took in this transaction.
      PERFORM pg_advisory_xact_lock(hashtextextended('invoices:' || NEW."reissued_invoice_id"::text, 0));
      SELECT * INTO cited FROM "invoices" i WHERE i."id" = NEW."reissued_invoice_id";
      IF NOT FOUND OR cited."kind" <> 'invoice' OR cited."member_id" <> NEW."member_id"
         OR cited."period" <> NEW."period" OR cited."regime_id" <> NEW."regime_id" OR cited."regime" <> NEW."regime"
         -- Its own mentions frame the regime's: first the invoice it corrects, last its payment terms.
         OR NEW."mentions"[1] NOT LIKE 'Facture rectificative de la facture ' || cited."number" || ' du %'
         OR NEW."mentions"[2:cardinality(NEW."mentions") - 1]
            IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(cited."regime" -> 'mentions')) THEN
        RAISE EXCEPTION 'a corrective invoice bills again an invoice of its contractor, citing it, with its period, its regime and the regime''s mentions (ADR 0040)'
          USING ERRCODE = 'restrict_violation';
      END IF;
      SELECT * INTO cancel FROM "invoices" c
      WHERE c."reissued_invoice_id" = cited."id" AND c."kind" = 'credit_note';
      IF NOT FOUND OR cancel."created_at" <> now() OR cancel."statement_id" IS DISTINCT FROM NEW."statement_id"
         OR cancel."excl_vat_minor" <> -NEW."excl_vat_minor" THEN
        RAISE EXCEPTION 'a corrective invoice bills again what the cancel written before it in its transaction took off invoice % (ADR 0040)', cited."number"
          USING ERRCODE = 'restrict_violation';
      END IF;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "contract_acceptances" a
      JOIN "contract_texts" t ON t."id" = a."text_id"
      WHERE a."member_id" = NEW."member_id" AND t."kind" = 'billing_mandate'
    ) THEN
      RAISE EXCEPTION 'an invoice is issued once its contractor has accepted a billing mandate (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- Two credit notes on one invoice at once are taken one after the other, each counting the one before.
  PERFORM pg_advisory_xact_lock(hashtextextended('invoices:' || NEW."credited_invoice_id"::text, 0));
  SELECT * INTO cited FROM "invoices" i WHERE i."id" = NEW."credited_invoice_id";
  IF NOT FOUND OR cited."kind" <> 'invoice' OR cited."member_id" <> NEW."member_id"
     OR cited."period" <> NEW."period" OR cited."regime_id" <> NEW."regime_id" OR cited."regime" <> NEW."regime" THEN
    RAISE EXCEPTION 'a credit note cites an invoice of its contractor and keeps its period and regime (ADR 0036)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF cited."excl_vat_minor" + NEW."excl_vat_minor" + coalesce((
    SELECT sum(n."excl_vat_minor") FROM "invoices" n
    WHERE n."credited_invoice_id" = cited."id" AND n."kind" = 'credit_note'
  ), 0) < 0 THEN
    RAISE EXCEPTION 'a credit note never takes more than what is left of invoice % (EQ-06)', cited."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- The cancel of a cancel and reissue (its `reissued_invoice_id` is the invoice it cites) leaves nothing of it.
  IF NEW."reissued_invoice_id" IS NOT NULL AND cited."excl_vat_minor" + NEW."excl_vat_minor" + coalesce((
    SELECT sum(n."excl_vat_minor") FROM "invoices" n
    WHERE n."credited_invoice_id" = cited."id" AND n."kind" = 'credit_note'
  ), 0) <> 0 THEN
    RAISE EXCEPTION 'the cancel of a cancel and reissue takes off all that is left of invoice % (ADR 0040)', cited."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- At the commit, both ways: the cancel and the corrective invoice of an invoice are written in one transaction (their
-- `created_at` is its instant), by the validation of one statement, of opposite amounts; never one without the other.
CREATE FUNCTION "check_invoice_reissue_at_commit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "invoices" o
    WHERE o."reissued_invoice_id" = NEW."reissued_invoice_id" AND o."kind" <> NEW."kind"
      AND o."created_at" = NEW."created_at" AND o."statement_id" IS NOT DISTINCT FROM NEW."statement_id"
      AND o."excl_vat_minor" = -NEW."excl_vat_minor"
  ) THEN
    RAISE EXCEPTION 'document % of a cancel and reissue is written with the other one, of the same amount, or neither is (ADR 0040)', NEW."number"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "invoices_reissue_whole_at_commit" AFTER INSERT ON "invoices"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."reissued_invoice_id" IS NOT NULL)
  EXECUTE FUNCTION "check_invoice_reissue_at_commit"();--> statement-breakpoint
-- 0050's function: an adjustment that names a contested document corrects the statement of that document's period,
-- the period a credit note on it keeps. For an invoice of its own period and for a credit note, that is the statement
-- 0050 read (the invoice's own, the cited invoice's); for a corrective invoice, issued by a later statement, it is the
-- statement of the period it bills again.
CREATE OR REPLACE FUNCTION "keep_contest_correction"() RETURNS trigger LANGUAGE plpgsql AS $$
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
    SELECT s."id" INTO corrected FROM "commission_statements" s
    WHERE s."member_id" = document."member_id" AND s."period" = document."period";
  END IF;
  IF NOT known OR document."member_id" <> NEW."member_id" OR corrected IS DISTINCT FROM NEW."corrects_statement_id" THEN
    RAISE EXCEPTION 'an adjustment corrects a contested document of its member, and that document''s period (EQ-06)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
