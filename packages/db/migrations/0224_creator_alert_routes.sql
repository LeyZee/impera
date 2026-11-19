-- ADR 0150: who each alert of a creator reaches, by role; the notification reason those alerts ring under; and the two
-- events they read in the journal (scripts_exhausted, offer_proposed).
CREATE TABLE "creator_alert_routes" (
	"creator_id" uuid NOT NULL,
	"alert_code" text NOT NULL,
	"role" text NOT NULL,
	"mode" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_alert_routes_pkey" PRIMARY KEY("creator_id","alert_code","role"),
	CONSTRAINT "creator_alert_routes_alert_code_check" CHECK ("creator_alert_routes"."alert_code" in ('safety_handoff', 'identity_doubt', 'sale', 'offer_proposed', 'script_price', 'scripts_exhausted', 'her_alerts', 'ai_budget', 'session_expired')),
	CONSTRAINT "creator_alert_routes_role_check" CHECK ("creator_alert_routes"."role" in ('owner', 'manager', 'chatter_on_shift')),
	CONSTRAINT "creator_alert_routes_mode_check" CHECK ("creator_alert_routes"."mode" in ('deliver', 'muted', 'off')),
	CONSTRAINT "creator_alert_routes_locked_check" CHECK ("creator_alert_routes"."alert_code" not in ('safety_handoff') or "creator_alert_routes"."mode" = 'deliver')
);
--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_reason_check";--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ADD CONSTRAINT "creator_alert_routes_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ADD CONSTRAINT "creator_alert_routes_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'reply_skipped', 'reply_deferred', 'desire_scored', 'fan_availability_changed', 'care_opened', 'care_closed', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'scripts_exhausted', 'offer_proposed', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'ai_quota_exhausted', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'agency_share_changed', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'reply_skipped', 'reply_deferred', 'desire_scored', 'fan_availability_changed', 'care_opened', 'care_closed', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'scripts_exhausted', 'offer_proposed', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'ai_quota_exhausted', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'agency_share_changed', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'own_shift_end', 'reminder', 'routine', 'streak', 'team', 'agency_share', 'creator_alert', 'safety_alert'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "creator_alert_routes" AS PERMISSIVE FOR ALL TO public USING ("creator_alert_routes"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("creator_alert_routes"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "creator_alert_routes" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Who each alert of hers reaches, by role (ADR 0150): written by the owner through the API under her RLS, closed to her
-- account; read by the alert router as the service role.
ALTER TABLE "creator_alert_routes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "creator_alert_routes" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "creator_alert_routes" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_alert_routes" TO impera_service;
