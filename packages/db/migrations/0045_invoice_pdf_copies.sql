-- EQ-06 lot 4, ADR 0037 (accepted by Charles, 01/11) and the audit of the invoice's rendering (01/11, every point
-- applied at Charles's request).
-- `invoice_pdfs.retain_until`: the end of the compliance lock as posed at the upload, so that a check reads what was
-- posed and a later change of the fiscal year's close touches only the PDFs after it. NOT NULL with no default: only
-- the PDF job writes this table, and nothing did before this lot, so no row exists anywhere.
-- `invoice_pdf_copies`: one row per copy, written once by the copy job, append-only like `invoice_pdfs` (0041),
-- rather than a column set afterwards on the PDF's row, which its trigger refuses to every role. A copy carries its
-- PDF's bytes and lock: `keep_invoice_pdf_copy` refuses one whose SHA-256 or lock differs from its PDF's row.
-- `billing_settings`: the month the fiscal year closes (the calendar year by default, until the accountant says
-- otherwise), the designation of the service each invoice prints (« Objet de la prestation »; without it nothing is
-- issued) and the logo. Each invoice copies the designation and names its logo by fingerprint (`invoices`), so that
-- its PDF renders again byte for byte whatever the settings hold since.
-- `agency_logos`: the logos, kept by fingerprint, append-only; small images read by each render, so in the base.
-- `contractor_profiles`: the SIREN or SIRET of a contractor established in France, their VAT number when they charge
-- VAT, and whether they are an individual entrepreneur (« EI » after their name). A change of these asks for a new
-- check of the file, like the other parts of the identity: `keep_contractor_profile` is replaced to count them.
-- Two new event types in both CHECKs (`invoice_pdf_conflict`, `invoice_pdf_missing`): additive, every row still
-- passes. The Telegram trigger's list is not touched: no rendering of these alerts yet (their own PR, with the module).
CREATE TABLE "agency_logos" (
	"sha256" text PRIMARY KEY NOT NULL,
	"media_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_logos_media_type_check" CHECK ("agency_logos"."media_type" in ('image/png')),
	CONSTRAINT "agency_logos_bytes_check" CHECK ("agency_logos"."sha256" ~ '^[0-9a-f]{64}$' and octet_length("agency_logos"."bytes") between 1 and 524288 and "agency_logos"."sha256" = encode(sha256("agency_logos"."bytes"), 'hex'))
);
--> statement-breakpoint
ALTER TABLE "agency_logos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_pdf_copies" (
	"invoice_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_pdf_copies_pkey" PRIMARY KEY("invoice_id","provider"),
	CONSTRAINT "invoice_pdf_copies_provider_check" CHECK ("invoice_pdf_copies"."provider" in ('ovhcloud')),
	CONSTRAINT "invoice_pdf_copies_file_check" CHECK (char_length("invoice_pdf_copies"."storage_key") between 1 and 512 and "invoice_pdf_copies"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "invoice_pdf_copies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "fiscal_year_end_month" smallint DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "service_description" text;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "logo_sha256" text;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD COLUMN "business_id" text;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD COLUMN "individual_entrepreneur" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_pdfs" ADD COLUMN "retain_until" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "service_description" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "logo_sha256" text;--> statement-breakpoint
ALTER TABLE "agency_logos" ADD CONSTRAINT "agency_logos_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_pdf_copies" ADD CONSTRAINT "invoice_pdf_copies_invoice_id_invoice_pdfs_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice_pdfs"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_logo_sha256_agency_logos_sha256_fk" FOREIGN KEY ("logo_sha256") REFERENCES "public"."agency_logos"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_logo_sha256_agency_logos_sha256_fk" FOREIGN KEY ("logo_sha256") REFERENCES "public"."agency_logos"("sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'error'));--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_fiscal_year_check" CHECK ("billing_settings"."fiscal_year_end_month" between 1 and 12);--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_service_check" CHECK ("billing_settings"."service_description" is null or char_length("billing_settings"."service_description") between 1 and 400);--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_ids_check" CHECK (("contractor_profiles"."business_id" is null or "contractor_profiles"."business_id" ~ '^([0-9]{9}|[0-9]{14})$') and ("contractor_profiles"."vat_number" is null or "contractor_profiles"."vat_number" ~ '^[A-Z]{2}[0-9A-Z]{2,13}$'));--> statement-breakpoint
ALTER TABLE "invoice_pdfs" ADD CONSTRAINT "invoice_pdfs_retention_check" CHECK ("invoice_pdfs"."retain_until" > "invoice_pdfs"."created_at");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_check" CHECK ("invoices"."service_description" is null or ("invoices"."kind" = 'invoice' and char_length("invoices"."service_description") between 1 and 400));--> statement-breakpoint
CREATE POLICY "team_read" ON "agency_logos" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "agency_logos" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "agency_logos"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "invoice_pdf_copies" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from invoices i where i.id = "invoice_pdf_copies"."invoice_id" and true));--> statement-breakpoint
ALTER TABLE "agency_logos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice_pdf_copies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "agency_logos_append_only" BEFORE UPDATE OR DELETE ON "agency_logos"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE TRIGGER "invoice_pdf_copies_append_only" BEFORE UPDATE OR DELETE ON "invoice_pdf_copies"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
-- A copy is its PDF's bytes under the same lock: same SHA-256, same end of lock, or nothing is written.
CREATE FUNCTION "keep_invoice_pdf_copy"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "invoice_pdfs" p
    WHERE p."invoice_id" = NEW."invoice_id" AND p."sha256" = NEW."sha256" AND p."retain_until" = NEW."retain_until"
  ) THEN
    RAISE EXCEPTION 'a copy holds its PDF''s bytes under its PDF''s lock (ADR 0037)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "invoice_pdf_copies_same_pdf" BEFORE INSERT ON "invoice_pdf_copies"
  FOR EACH ROW EXECUTE FUNCTION "keep_invoice_pdf_copy"();--> statement-breakpoint
-- 0041's function, with the three new parts of a contractor's identity in the change that withdraws the check.
CREATE OR REPLACE FUNCTION "keep_contractor_profile"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope CONSTANT text := nullif(current_setting('app.team_scope', true), '');
  actor CONSTANT text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."verified_at" IS NOT NULL THEN
      RAISE EXCEPTION 'a contractor''s file is checked after it is written (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."invoice_prefix" IS NOT NULL AND scope IS NOT NULL AND scope <> 'owner' THEN
      RAISE EXCEPTION 'only the owner sets a contractor''s prefix (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."member_id", NEW."created_at") IS DISTINCT FROM (OLD."member_id", OLD."created_at") THEN
    RAISE EXCEPTION 'file % keeps its contractor (EQ-06)', OLD."member_id" USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."invoice_prefix" IS DISTINCT FROM OLD."invoice_prefix" THEN
    IF scope IS NOT NULL AND scope <> 'owner' THEN
      RAISE EXCEPTION 'only the owner sets a contractor''s prefix (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "invoices" i WHERE i."member_id" = OLD."member_id") THEN
      RAISE EXCEPTION 'the prefix of % is frozen by his first invoice (EQ-06)', OLD."member_id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF (NEW."legal_name", NEW."address", NEW."tax_id", NEW."business_id", NEW."vat_number",
      NEW."individual_entrepreneur", NEW."email") IS DISTINCT FROM
     (OLD."legal_name", OLD."address", OLD."tax_id", OLD."business_id", OLD."vat_number",
      OLD."individual_entrepreneur", OLD."email") THEN
    NEW."verified_at" := NULL;
    NEW."verified_by" := NULL;
  ELSIF NEW."verified_at" IS NOT NULL
        AND (NEW."verified_at", NEW."verified_by") IS DISTINCT FROM (OLD."verified_at", OLD."verified_by") THEN
    IF scope IS NOT NULL AND (scope <> 'owner' OR NEW."verified_by" IS DISTINCT FROM actor) THEN
      RAISE EXCEPTION 'only the owner checks a contractor''s file, in his own name (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW."verified_at" IS NULL AND OLD."verified_at" IS NOT NULL AND scope IS NOT NULL AND scope <> 'owner' THEN
    RAISE EXCEPTION 'only the owner withdraws his check (EQ-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the application reads both and the owner adds a logo; the jobs
-- (`nirvana_admin`) write the copies.
REVOKE ALL ON "agency_logos", "invoice_pdf_copies" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "agency_logos" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "invoice_pdf_copies" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("fiscal_year_end_month", "service_description", "logo_sha256") ON "billing_settings" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("business_id", "vat_number", "individual_entrepreneur") ON "contractor_profiles" TO nirvana_app;
