-- The Telegram module reads `invoice_pdf_conflict` and `invoice_pdf_missing` (EQ-06 lot 4, ADR 0037): another file under a
-- document's key, or a PDF (or its copy) still missing after the last attempt, told to the owner as important by the
-- document's number and place, never the member. The types and their CHECKs came with 0045; only the trigger's list
-- changes here (it mirrors SCANNED_EVENT_TYPES in the telegram module, a test compares them); the function is
-- unchanged.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
