-- Décision de Charles du 27/11/2026 (audit de robustesse R3): the daily reminder to reconnect the AI's platform
-- sessions rings at the agency's minute `session_reminder_minute`, 18 h (1080) by default, never off. No row is touched
-- beyond the default.
ALTER TABLE "scheduling_settings" ADD COLUMN "session_reminder_minute" integer DEFAULT 1080 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_settings" ADD CONSTRAINT "scheduling_settings_session_reminder_check" CHECK ("scheduling_settings"."session_reminder_minute" between 0 and 1439);
