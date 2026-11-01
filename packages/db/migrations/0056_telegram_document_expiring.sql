-- The Telegram module reads `contractor_document_expiring` (EQ-06 lot 5c-2): a contractor's document comes to its end
-- with no newer one filed, told to the owner as important by its kind and last day, never a name. The type and its two
-- CHECKs came with 0055; only the trigger's list changes here (it mirrors SCANNED_EVENT_TYPES in the telegram module, a
-- test compares them); the function is unchanged.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'contractor_document_expiring'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
