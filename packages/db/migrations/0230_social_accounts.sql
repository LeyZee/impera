CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"username" text NOT NULL,
	"usage" text NOT NULL,
	"agent_may_share" boolean DEFAULT false NOT NULL,
	"position" smallint NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_platform_check" CHECK ("social_accounts"."platform" in ('instagram', 'tiktok', 'x', 'youtube', 'twitch', 'other')),
	CONSTRAINT "social_accounts_usage_check" CHECK ("social_accounts"."usage" in ('lives', 'practice', 'personal', 'other')),
	CONSTRAINT "social_accounts_username_check" CHECK (char_length("social_accounts"."username") between 1 and 60 and "social_accounts"."username" ~ '^[[:alnum:]._-]+$'),
	CONSTRAINT "social_accounts_position_check" CHECK ("social_accounts"."position" >= 0 and "social_accounts"."position" < 12)
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_creator_account_unique" ON "social_accounts" USING btree ("creator_id","platform",lower("username"));--> statement-breakpoint
CREATE INDEX "social_accounts_creator_idx" ON "social_accounts" USING btree ("creator_id","position");--> statement-breakpoint
CREATE POLICY "team_read" ON "social_accounts" AS PERMISSIVE FOR SELECT TO public USING ("social_accounts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') is null or nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "social_accounts" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("social_accounts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "social_accounts"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "social_accounts" AS PERMISSIVE FOR UPDATE TO public USING ("social_accounts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK ("social_accounts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "social_accounts"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_delete" ON "social_accounts" AS PERMISSIVE FOR DELETE TO public USING ("social_accounts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "social_accounts" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Written by hand. Drizzle does not write what follows.
-- ADR 0143 § C and § 20: « Ses comptes », read in her tenant (the owner, a manager, the jobs), written by the owner
-- alone, closed to her own account. Real data: nothing of it in the repository.
ALTER TABLE "social_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app reads and the owner's session writes the list.
REVOKE ALL ON "social_accounts" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "social_accounts" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "social_accounts" TO impera_service;
--> statement-breakpoint
-- ADR 0143 § 13: `account_shared` (the use of the account a draft gave him, never its name) joins the event types.
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'account_shared', 'reply_skipped', 'reply_deferred', 'desire_scored', 'fan_availability_changed', 'care_opened', 'care_closed', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'ai_quota_exhausted', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'agency_share_changed', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'custom_order_opened', 'objection_reply_used', 'account_shared', 'reply_skipped', 'reply_deferred', 'desire_scored', 'fan_availability_changed', 'care_opened', 'care_closed', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_step_opened', 'script_step_refused', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'ai_credits_low', 'ai_quota_exhausted', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'fan_fragile_dismissed', 'sales_feed_signal', 'sales_feed_mismatch', 'agency_share_mismatch', 'agency_share_changed', 'connection_state_changed', 'security_alert', 'content_drop_received', 'content_media_expiring', 'content_media_erased', 'content_media_erase_failed', 'error'));