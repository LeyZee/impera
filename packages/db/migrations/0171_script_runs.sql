-- ADR 0098: a script of her catalogue run with one fan, step by step (`script_runs`), written by the agent in her tenant
-- (withTenant, nirvana_app) and never deleted; and the two events of a step, opened or refused. At most one open run per
-- conversation. Its decision state only: what was sent and bought to him is Reveal's history (ADR 0018 § 5), read before
-- any decision. `script_ref` is the platform's script, one plain column so that it can follow the identity Médias settles.
CREATE TABLE "script_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"script_ref" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ignored_messages" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_runs_status_check" CHECK ("script_runs"."status" in ('open', 'bought_out', 'refused', 'stalled', 'closed_by_human')),
	CONSTRAINT "script_runs_steps_check" CHECK (jsonb_typeof("script_runs"."steps") = 'array'),
	CONSTRAINT "script_runs_ignored_messages_check" CHECK ("script_runs"."ignored_messages" >= 0),
	CONSTRAINT "script_runs_ended_check" CHECK (("script_runs"."status" = 'open') = ("script_runs"."ended_at" is null))
);
--> statement-breakpoint
ALTER TABLE "script_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "script_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Never deleted: an ended run is history.
REVOKE ALL ON "script_runs" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "script_runs" TO nirvana_app;--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "script_runs" ADD CONSTRAINT "script_runs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_runs" ADD CONSTRAINT "script_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_runs_open_unique" ON "script_runs" USING btree ("conversation_id") WHERE "script_runs"."status" = 'open';--> statement-breakpoint
CREATE INDEX "script_runs_conversation_idx" ON "script_runs" USING btree ("conversation_id","started_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "script_runs" AS PERMISSIVE FOR ALL TO public USING ("script_runs"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("script_runs"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "script_runs" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');