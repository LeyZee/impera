-- The Telegram module reads `alert_triggered` (P4-01): one of her alerts that only lets a human know, sent when
-- `notify` was on when it rang. `keyword_matched` leaves the list: it never had a producer, a word of hers is an
-- `alert_triggered` or a `handoff_requested` now. Only the trigger's list changes (it mirrors SCANNED_EVENT_TYPES
-- in the telegram module, a test compares them); the function is unchanged.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
