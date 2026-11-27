-- Charles, 21/11/2026: an invoice no longer waits for the accountant's validation of its regime. 0052's function,
-- without that check: the day the accountant validated a regime stays a note the owner may record, never a gate.
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
         -- Its own mentions frame the regime's: first the invoice it corrects, last its payment terms. At least those
         -- two, so that the first is there (`invoices_copies_check` keeps nulls out) and its test is never null.
         OR cardinality(NEW."mentions") < 2
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
