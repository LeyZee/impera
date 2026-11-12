-- ADR 0091: the AI credits ledger (top-ups and balance readings the owner writes down in Réglages › Consommation IA),
-- agency rows out of tenancy, RLS forced with `agency_only`; and `ai_credits_low`, the hourly check's alert, enters the
-- two type checks of the event tables.
CREATE TABLE "ai_credit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_credit_entries_provider_check" CHECK ("ai_credit_entries"."provider" in ('xai', 'mistral', 'google')),
	CONSTRAINT "ai_credit_entries_kind_check" CHECK ("ai_credit_entries"."kind" in ('topup', 'balance')),
	CONSTRAINT "ai_credit_entries_currency_check" CHECK ("ai_credit_entries"."currency" in ('USD', 'EUR')),
	CONSTRAINT "ai_credit_entries_amount_check" CHECK ("ai_credit_entries"."amount_minor" between 0 and 1000000 and ("ai_credit_entries"."kind" = 'balance' or "ai_credit_entries"."amount_minor" > 0))
);
--> statement-breakpoint
ALTER TABLE "ai_credit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "ai_credit_entries" ADD CONSTRAINT "ai_credit_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_credit_entries_provider_at_idx" ON "ai_credit_entries" USING btree ("provider","at");--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
CREATE POLICY "agency_only" ON "ai_credit_entries" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
ALTER TABLE "ai_credit_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "ai_credit_entries" TO nirvana_app;
--> statement-breakpoint
-- The Telegram trigger's list of event types (it mirrors SCANNED_EVENT_TYPES in the telegram module, a test compares
-- them) takes `ai_credits_low` (ADR 0091 § 4). The function is unchanged; no row is touched.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'contractor_document_expiring', 'invoice_due_soon', 'invoice_overdue', 'security_alert', 'sales_feed_mismatch', 'connection_state_changed', 'agency_share_mismatch', 'sales_feed_signal', 'ai_credits_low'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
