-- The Telegram module reads `exchange_rate_overdue` (ADR 0033): no ECB rate of a currency pay converts for more
-- than two weekdays, told to the owner as important. The type and its two CHECKs came with 0030; only the trigger's
-- list changes here (it mirrors SCANNED_EVENT_TYPES in the telegram module, a test compares them); the function is
-- unchanged.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue', 'exchange_rate_overdue'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
