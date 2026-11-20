-- Two changes of the creator alerts, kept in one migration as their pull request is one.
-- 1. The sorts of notification a creator turns on or off herself in Moi › Notifications (ADR 0150 § 16 ter): one row
--    per account and sort, no row meaning on. Each account reads and writes only its own rows (own_rows); the agency
--    never sees them. The service role may read them (ADR 0087) and never writes them.
-- 2. ADR 0094 § 1, lot a (« compte sans personne »): `account_uncovered` joins the closed list of event types,
--    published once per account and créneau (unique index), and the Telegram trigger's list (it mirrors
--    SCANNED_EVENT_TYPES in the telegram module, a test compares them): told in Important to the groups for all. The
--    creator's Alertes tab (ADR 0150) gains `uncovered_account`, never to a chatter (ADR 0094 § 3): the base refuses a
--    « chatteur en shift » row other than `off`. A partial index answers « did a fan write to this account lately »
--    without reading the conversations. No row is touched.
CREATE TABLE "notification_kind_preferences" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_kind_preferences_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "notification_kind_preferences_kind_check" CHECK ("notification_kind_preferences"."kind" in ('agency_request', 'week_to_validate', 'earnings', 'lives'))
);
--> statement-breakpoint
ALTER TABLE "notification_kind_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_alert_routes" DROP CONSTRAINT "creator_alert_routes_alert_code_check";--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "notification_kind_preferences" ADD CONSTRAINT "notification_kind_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_account_fan_recent_idx" ON "messages" USING btree ("platform_account_id","platform_created_at" DESC NULLS LAST) WHERE "messages"."direction" = 'inbound';--> statement-breakpoint
CREATE UNIQUE INDEX "domain_events_account_uncovered_unique" ON "domain_events" USING btree (("payload"->>'platformAccountId'),("payload"->>'slotStartsAt')) WHERE "domain_events"."type" = 'account_uncovered';--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ADD CONSTRAINT "creator_alert_routes_chatters_closed_check" CHECK ("creator_alert_routes"."alert_code" not in ('uncovered_account') or "creator_alert_routes"."role" <> 'chatter_on_shift' or "creator_alert_routes"."mode" = 'off');--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ADD CONSTRAINT "creator_alert_routes_alert_code_check" CHECK ("creator_alert_routes"."alert_code" in ('safety_handoff', 'identity_doubt', 'sale', 'offer_proposed', 'script_price', 'scripts_exhausted', 'her_alerts', 'ai_budget', 'session_expired', 'uncovered_account'));--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'reply_skipped', 'reply_deferred', 'desire_scored', 'fan_availability_changed', 'care_opened', 'care_closed', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'scripts_exhausted', 'offer_proposed', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'ai_quota_exhausted', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'agency_share_changed', 'account_uncovered', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'reply_skipped', 'reply_deferred', 'desire_scored', 'fan_availability_changed', 'care_opened', 'care_closed', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'scripts_exhausted', 'offer_proposed', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'ai_quota_exhausted', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'agency_share_changed', 'account_uncovered', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
CREATE POLICY "own_rows" ON "notification_kind_preferences" AS PERMISSIVE FOR ALL TO public USING ("notification_kind_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("notification_kind_preferences"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "notification_kind_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "notification_kind_preferences" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification_kind_preferences" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "notification_kind_preferences" TO impera_service;--> statement-breakpoint
DROP TRIGGER IF EXISTS "domain_events_telegram_scan" ON "domain_events";--> statement-breakpoint
CREATE TRIGGER "domain_events_telegram_scan" AFTER INSERT ON "domain_events"
  FOR EACH ROW
  WHEN (NEW.type IN ('handoff_requested', 'budget_threshold_crossed', 'session_state_changed', 'kill_switch_toggled', 'takeover_started', 'takeover_ended', 'sale_detected', 'alert_triggered', 'validation_requested', 'validation_resolved', 'automatic_closed', 'send_failed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'contractor_document_expiring', 'invoice_due_soon', 'invoice_overdue', 'security_alert', 'sales_feed_mismatch', 'connection_state_changed', 'agency_share_mismatch', 'agency_share_changed', 'sales_feed_signal', 'ai_credits_low', 'ai_quota_exhausted', 'account_uncovered'))
  EXECUTE FUNCTION "telegram_enqueue_scan"();
