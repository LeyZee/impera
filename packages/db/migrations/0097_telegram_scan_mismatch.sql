-- The Telegram trigger's list of event types (it mirrors SCANNED_EVENT_TYPES in the telegram module, a test compares
-- them) takes `sales_feed_mismatch` (CRM-04 b3, question 6: rendered in Important) and, ahead of its producer,
-- `connection_state_changed` (P3-12 lot 2, Bilan), so that its arrival needs no migration of this trigger. The
-- function is unchanged; no row is touched.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'contractor_document_expiring', 'invoice_due_soon', 'invoice_overdue', 'security_alert', 'sales_feed_mismatch', 'connection_state_changed'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
