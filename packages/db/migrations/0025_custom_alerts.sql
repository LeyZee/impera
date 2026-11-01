-- Alerts (P4-01): `custom_alerts`, her own alerts, one row per creator with a `group_id` shared by the rows written
-- together, archived rather than deleted; `system_alert_settings`, the system's alerts switched off for a creator (no
-- row is on, `keyword` always is); `alert_seen`, the « vu » of the history, since the journal is append-only. A new
-- event type, `alert_triggered`, in the type checks of both journals, and a new Telegram topic, `custom`, in the topic
-- checks of routes and deliveries. Additive.
CREATE TABLE "alert_seen" (
	"event_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"seen_by" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_seen_pkey" PRIMARY KEY("creator_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "alert_seen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "custom_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phrase" text,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"pauses_agent" boolean NOT NULL,
	"notify" boolean NOT NULL,
	"enabled" boolean NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "custom_alerts_group_creator_unique" UNIQUE("group_id","creator_id"),
	CONSTRAINT "custom_alerts_name_check" CHECK (char_length("custom_alerts"."name") between 1 and 80),
	CONSTRAINT "custom_alerts_phrase_check" CHECK ("custom_alerts"."phrase" is null or char_length("custom_alerts"."phrase") between 1 and 500),
	CONSTRAINT "custom_alerts_keywords_check" CHECK (cardinality("custom_alerts"."keywords") <= 40 and array_position("custom_alerts"."keywords", null) is null and char_length(array_to_string("custom_alerts"."keywords", '')) <= 4000),
	CONSTRAINT "custom_alerts_matcher_check" CHECK ("custom_alerts"."phrase" is not null or cardinality("custom_alerts"."keywords") > 0)
);
--> statement-breakpoint
ALTER TABLE "custom_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system_alert_settings" (
	"creator_id" uuid NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_alert_settings_pkey" PRIMARY KEY("creator_id","code"),
	CONSTRAINT "system_alert_settings_code_check" CHECK ("system_alert_settings"."code" in ('keyword', 'service_request', 'identity_doubt')),
	CONSTRAINT "system_alert_settings_keyword_check" CHECK ("system_alert_settings"."code" <> 'keyword' or "system_alert_settings"."enabled")
);
--> statement-breakpoint
ALTER TABLE "system_alert_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "telegram_deliveries" DROP CONSTRAINT "telegram_deliveries_topic_check";--> statement-breakpoint
ALTER TABLE "telegram_routes" DROP CONSTRAINT "telegram_routes_topic_check";--> statement-breakpoint
ALTER TABLE "alert_seen" ADD CONSTRAINT "alert_seen_event_id_conversation_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."conversation_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_seen" ADD CONSTRAINT "alert_seen_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_seen" ADD CONSTRAINT "alert_seen_seen_by_user_id_fk" FOREIGN KEY ("seen_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_alerts" ADD CONSTRAINT "custom_alerts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_alerts" ADD CONSTRAINT "custom_alerts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_alerts" ADD CONSTRAINT "custom_alerts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_alert_settings" ADD CONSTRAINT "system_alert_settings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_alert_settings" ADD CONSTRAINT "system_alert_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_alerts_creator_idx" ON "custom_alerts" USING btree ("creator_id") WHERE "custom_alerts"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'error'));--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_topic_check" CHECK ("telegram_deliveries"."topic" in ('urgent', 'important', 'info', 'sale', 'keyword', 'validation', 'custom'));--> statement-breakpoint
ALTER TABLE "telegram_routes" ADD CONSTRAINT "telegram_routes_topic_check" CHECK ("telegram_routes"."topic" in ('urgent', 'important', 'info', 'sale', 'keyword', 'validation', 'custom'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "alert_seen" AS PERMISSIVE FOR ALL TO public USING ("alert_seen"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("alert_seen"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_alerts" AS PERMISSIVE FOR ALL TO public USING ("custom_alerts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("custom_alerts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "system_alert_settings" AS PERMISSIVE FOR ALL TO public USING ("system_alert_settings"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("system_alert_settings"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "custom_alerts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_alert_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_seen" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- An alert is archived, never deleted; a setting is changed, never removed; a seen mark is written once and stays.
GRANT SELECT, INSERT, UPDATE ON "custom_alerts", "system_alert_settings" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "alert_seen" TO nirvana_app;
