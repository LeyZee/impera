-- Two notification reasons for the agency's alerts to its owners (27/11/2026).
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_reason_check";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'own_shift_end', 'reminder', 'routine', 'streak', 'team', 'agency_share', 'creator_alert', 'safety_alert', 'owner_change', 'decision', 'agency_alert', 'agency_urgent'));--> statement-breakpoint
-- Telegram goes back to the creators' channels only (decision of Charles, 27/11/2026): the agency's alerts and the
-- safety relays now ring through the app's notifications (`agency_alert`, `agency_urgent`, jobs `alerts.agency` and
-- `alerts.remind_safety`). The outbox no longer wakes a Telegram scan: its trigger and function go. No table and no
-- row is touched; the tables Telegram's alerts used stay, unread, until Charles says otherwise.
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
DROP FUNCTION IF EXISTS "telegram_enqueue_scan"();
