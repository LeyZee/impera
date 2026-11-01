-- `invoice_not_issued` (EQ-06 lot 3, ADR 0036): a validated statement owes an invoice or a credit note the job could
-- not issue (no mandate, no regime, an identity or a prefix missing, no invoice to take a credit note). The statement
-- stays validated; the owner reads why. Additive: a new event type in both CHECKs, every existing row still passes.
-- The Telegram trigger's list is not touched here: it mirrors SCANNED_EVENT_TYPES in the telegram module (a test
-- compares them), and both change together with the Telegram rendering.
-- A document keeps one mention more than a regime holds: an invoice prints its payment terms after its regime's
-- mentions (art. L441-9 of the Code de commerce), a credit note the invoice it cites before them (ADR 0036). Looser,
-- every row still passes.
-- An invoice falls due 60 days after its issue at the latest (art. L441-10 of the Code de commerce): the agency's due
-- delay goes from 90 days at most to 60. Narrower; nothing is deployed, and no settings row above 60 exists.
-- The payment terms an invoice prints after its due date (no discount, late-payment penalties, the 40 EUR indemnity)
-- are the agency's words, a setting its accountant validates, never the code's: `payment_terms`, required. NOT NULL
-- with no default: nothing is deployed, and no screen nor endpoint writes `billing_settings` before EQ-06 lot 8. The
-- application may update it, as the other settings (0041 grants UPDATE column by column).
ALTER TABLE "conversation_events" DROP CONSTRAINT "conversation_events_type_check";--> statement-breakpoint
ALTER TABLE "domain_events" DROP CONSTRAINT "domain_events_type_check";--> statement-breakpoint
ALTER TABLE "billing_settings" DROP CONSTRAINT "billing_settings_delays_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_copies_check";--> statement-breakpoint
ALTER TABLE "billing_settings" ADD COLUMN "payment_terms" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_type_check" CHECK ("conversation_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'error'));--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_type_check" CHECK ("domain_events"."type" in ('message_received', 'message_sent', 'send_attempted', 'send_failed', 'send_verified', 'media_described', 'draft_created', 'draft_approved', 'draft_edited', 'draft_rejected', 'draft_expired', 'fact_proposed', 'fact_confirmed', 'fact_rejected', 'summary_refreshed', 'handoff_requested', 'alert_triggered', 'reply_skipped', 'reply_deferred', 'desire_scored', 'takeover_started', 'takeover_ended', 'mode_changed', 'kill_switch_toggled', 'follow_up_scheduled', 'follow_up_cancelled', 'offer_made', 'sale_detected', 'script_started', 'script_step_sent', 'script_ended', 'session_state_changed', 'budget_threshold_crossed', 'backup_overdue', 'exchange_rate_overdue', 'invoice_not_issued', 'automatic_closed', 'fan_flag_set', 'fan_flag_cleared', 'error'));--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_payment_terms_check" CHECK (char_length("billing_settings"."payment_terms") between 1 and 360);--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_delays_check" CHECK ("billing_settings"."due_days" between 1 and 60 and "billing_settings"."document_reminder_days" between 1 and 120);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_copies_check" CHECK (jsonb_typeof("invoices"."contractor") = 'object' and jsonb_typeof("invoices"."agency") = 'object' and jsonb_typeof("invoices"."regime") = 'object' and cardinality("invoices"."mentions") <= 25 and array_position("invoices"."mentions", null) is null);--> statement-breakpoint
-- The owner changes the payment terms like the other settings: 0041 grants UPDATE column by column.
GRANT UPDATE ("payment_terms") ON "billing_settings" TO nirvana_app;
