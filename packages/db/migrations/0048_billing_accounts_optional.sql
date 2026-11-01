-- The purchase journal's accounts become optional (EQ-06, Réglages > Facturation): the accountant gives them for the
-- accounting export (lot 7), which never leaves without them, while the agency's identity, the designation of the
-- service and the payment terms are what an invoice needs. Without this, the owner could not save the settings that
-- let invoices be issued before inventing accounts. Additive: every existing row still passes the new CHECK.
ALTER TABLE "billing_settings" DROP CONSTRAINT "billing_settings_json_check";--> statement-breakpoint
ALTER TABLE "billing_settings" ALTER COLUMN "accounts" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_json_check" CHECK (jsonb_typeof("billing_settings"."agency") = 'object' and ("billing_settings"."accounts" is null or jsonb_typeof("billing_settings"."accounts") = 'object'));