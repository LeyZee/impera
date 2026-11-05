-- CRM-07 lot a2 (ADR 0069 § 5). What the platform's model list showed last, one row per model ever listed: its status,
-- when it was first and last listed, and whether a linked model gone from the list or banned was already signalled.
-- The badge « N nouvelles créatrices » reads it without calling the platform. Agency-level, closed to a creator's own
-- account; the reading job updates the rows, never deletes them, so the application role gets no DELETE.
CREATE TABLE "sales_feed_model_sightings" (
	"platform" text NOT NULL,
	"platform_model_id" text NOT NULL,
	"status" text NOT NULL,
	"is_active" boolean NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_signalled_at" timestamp with time zone,
	"banned_signalled_at" timestamp with time zone,
	CONSTRAINT "sales_feed_model_sightings_pk" PRIMARY KEY("platform","platform_model_id"),
	CONSTRAINT "sales_feed_model_sightings_platform_check" CHECK ("sales_feed_model_sightings"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "sales_feed_model_sightings_status_check" CHECK ("sales_feed_model_sightings"."status" in ('validated', 'pending', 'onboarding_changes_requested', 'refused', 'banned', 'other')),
	CONSTRAINT "sales_feed_model_sightings_id_check" CHECK (char_length("sales_feed_model_sightings"."platform_model_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "sales_feed_model_sightings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agency_only" ON "sales_feed_model_sightings" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
ALTER TABLE "sales_feed_model_sightings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "sales_feed_model_sightings" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_feed_model_sightings" TO nirvana_app;
--> statement-breakpoint
-- The Telegram trigger's list of event types (it mirrors SCANNED_EVENT_TYPES in the telegram module, a test compares
-- them) takes `sales_feed_signal`: a linked model gone from the platform's list or banned is told in Important, without
-- her name (ADR 0069 § 5); the module drops the other signals. The function is unchanged; no row is touched.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'contractor_document_expiring', 'invoice_due_soon', 'invoice_overdue', 'security_alert', 'sales_feed_mismatch', 'connection_state_changed', 'agency_share_mismatch', 'sales_feed_signal'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
