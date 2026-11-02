-- The sales feed (ADR 0050, CRM-01): a platform's register of sales and refunds read with an agency key, without any
-- captured session. `sales_feed_credentials` holds the key sealed with CREDENTIALS_ENCRYPTION_KEYS, out of RLS and
-- revoked from the application role (ADR 0016 § 3). `sales_feed_cursors` is where the reading stands, moved in the
-- transaction that records the lines. `platform_sales` is the register of linked models, one line per sale and event,
-- append-only and under the tenant policy; `platform_sales_quarantine` keeps the lines of a model linked to no creator
-- account until the owner links it. `sales_feed_models` and `sales_feed_chatters` are the owner's links. A new event
-- type, `sales_feed_signal`, in both CHECKs; additive, every existing row still passes.
CREATE TABLE "platform_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_sale_id" text NOT NULL,
	"event" text NOT NULL,
	"sale_type" text NOT NULL,
	"raw_type" text,
	"status" text NOT NULL,
	"raw_status" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"platform_model_id" text NOT NULL,
	"platform_chatter_id" text,
	"platform_fan_id" text,
	"currency" text NOT NULL,
	"gross_incl_vat_minor" integer NOT NULL,
	"gross_excl_vat_minor" integer NOT NULL,
	"net_minor" integer NOT NULL,
	"agency_minor" integer NOT NULL,
	"creator_minor" integer NOT NULL,
	"position" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_sales_line_unique" UNIQUE("platform","platform_sale_id","event"),
	CONSTRAINT "platform_sales_platform_check" CHECK ("platform_sales"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "platform_sales_event_check" CHECK ("platform_sales"."event" in ('sale', 'refund')),
	CONSTRAINT "platform_sales_sale_type_check" CHECK ("platform_sales"."sale_type" in ('subscription', 'renewal', 'ppv', 'mass_dm', 'tip', 'payment_link', 'boudoir', 'paid_message', 'other')),
	CONSTRAINT "platform_sales_status_check" CHECK ("platform_sales"."status" in ('paid', 'refund_asked', 'refunded', 'other')),
	CONSTRAINT "platform_sales_currency_check" CHECK ("platform_sales"."currency" in ('EUR', 'USD')),
	CONSTRAINT "platform_sales_net_check" CHECK ("platform_sales"."net_minor" = "platform_sales"."agency_minor" + "platform_sales"."creator_minor"),
	CONSTRAINT "platform_sales_amounts_check" CHECK ("platform_sales"."gross_incl_vat_minor" >= 0 and "platform_sales"."gross_excl_vat_minor" >= 0 and "platform_sales"."agency_minor" >= 0 and "platform_sales"."creator_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "platform_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_sales_quarantine" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"platform_sale_id" text NOT NULL,
	"event" text NOT NULL,
	"sale_type" text NOT NULL,
	"raw_type" text,
	"status" text NOT NULL,
	"raw_status" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"platform_model_id" text NOT NULL,
	"platform_chatter_id" text,
	"platform_fan_id" text,
	"currency" text NOT NULL,
	"gross_incl_vat_minor" integer NOT NULL,
	"gross_excl_vat_minor" integer NOT NULL,
	"net_minor" integer NOT NULL,
	"agency_minor" integer NOT NULL,
	"creator_minor" integer NOT NULL,
	"position" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "platform_sales_quarantine_line_unique" UNIQUE("platform","platform_sale_id","event"),
	CONSTRAINT "platform_sales_quarantine_platform_check" CHECK ("platform_sales_quarantine"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "platform_sales_quarantine_event_check" CHECK ("platform_sales_quarantine"."event" in ('sale', 'refund')),
	CONSTRAINT "platform_sales_quarantine_sale_type_check" CHECK ("platform_sales_quarantine"."sale_type" in ('subscription', 'renewal', 'ppv', 'mass_dm', 'tip', 'payment_link', 'boudoir', 'paid_message', 'other')),
	CONSTRAINT "platform_sales_quarantine_status_check" CHECK ("platform_sales_quarantine"."status" in ('paid', 'refund_asked', 'refunded', 'other')),
	CONSTRAINT "platform_sales_quarantine_currency_check" CHECK ("platform_sales_quarantine"."currency" in ('EUR', 'USD')),
	CONSTRAINT "platform_sales_quarantine_net_check" CHECK ("platform_sales_quarantine"."net_minor" = "platform_sales_quarantine"."agency_minor" + "platform_sales_quarantine"."creator_minor")
);
--> statement-breakpoint
CREATE TABLE "sales_feed_chatters" (
	"platform" text NOT NULL,
	"platform_chatter_id" text NOT NULL,
	"kind" text NOT NULL,
	"member_id" uuid,
	"linked_by" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_chatters_pk" PRIMARY KEY("platform","platform_chatter_id"),
	CONSTRAINT "sales_feed_chatters_platform_check" CHECK ("sales_feed_chatters"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "sales_feed_chatters_kind_check" CHECK ("sales_feed_chatters"."kind" in ('member', 'agent')),
	CONSTRAINT "sales_feed_chatters_member_check" CHECK (("sales_feed_chatters"."kind" = 'member') = ("sales_feed_chatters"."member_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_feed_credentials" (
	"platform" text PRIMARY KEY NOT NULL,
	"key_ciphertext" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"state" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error_kind" text,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_credentials_platform_check" CHECK ("sales_feed_credentials"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "sales_feed_credentials_state_check" CHECK ("sales_feed_credentials"."state" in ('connected', 'needs_reconnect')),
	CONSTRAINT "sales_feed_credentials_last_error_kind_check" CHECK ("sales_feed_credentials"."last_error_kind" in ('malformed', 'unauthorized', 'missing_access', 'rate_limited', 'unreachable', 'unexpected_answer'))
);
--> statement-breakpoint
CREATE TABLE "sales_feed_cursors" (
	"platform" text PRIMARY KEY NOT NULL,
	"position" text,
	"read_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_cursors_platform_check" CHECK ("sales_feed_cursors"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana'))
);
--> statement-breakpoint
CREATE TABLE "sales_feed_models" (
	"platform" text NOT NULL,
	"platform_model_id" text NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"linked_by" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_models_pk" PRIMARY KEY("platform","platform_model_id"),
	CONSTRAINT "sales_feed_models_account_unique" UNIQUE("platform_account_id"),
	CONSTRAINT "sales_feed_models_platform_check" CHECK ("sales_feed_models"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana'))
);
--> statement-breakpoint
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "platform_sales" ADD CONSTRAINT "platform_sales_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sales" ADD CONSTRAINT "platform_sales_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_feed_chatters" ADD CONSTRAINT "sales_feed_chatters_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_feed_models" ADD CONSTRAINT "sales_feed_models_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_feed_models" ADD CONSTRAINT "sales_feed_models_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_sales_creator_occurred_idx" ON "platform_sales" USING btree ("creator_id","occurred_at");--> statement-breakpoint
CREATE INDEX "platform_sales_account_chatter_idx" ON "platform_sales" USING btree ("platform_account_id","platform_chatter_id","occurred_at");--> statement-breakpoint
CREATE INDEX "platform_sales_quarantine_waiting_idx" ON "platform_sales_quarantine" USING btree ("platform","platform_model_id") WHERE "platform_sales_quarantine"."released_at" is null;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'sales_feed_signal', 'security_alert', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'invoice_pdf_conflict', 'invoice_pdf_missing', 'invoice_contested', 'invoice_due_soon', 'invoice_overdue', 'contractor_document_expiring', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'sales_feed_signal', 'security_alert', 'error'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "platform_sales" AS PERMISSIVE FOR ALL TO public USING ("platform_sales"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("platform_sales"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "platform_sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A refund is a line of its own; a line is never rewritten nor removed, whoever asks.
CREATE TRIGGER "platform_sales_append_only" BEFORE UPDATE OR DELETE ON "platform_sales"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- The Reveal key: read and written through withAdmin only (ADR 0050 § 4). The default privileges of init.sql would
-- hand DML to the application role; this table keeps it out.
REVOKE ALL ON "sales_feed_credentials" FROM nirvana_app;--> statement-breakpoint
-- The application role reads and writes the rest: the register by insert only (its lines are never rewritten), the
-- cursor, the quarantine (a line is marked released) and the owner's links.
GRANT SELECT, INSERT ON "platform_sales" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_feed_cursors", "platform_sales_quarantine" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sales_feed_models", "sales_feed_chatters" TO nirvana_app;
