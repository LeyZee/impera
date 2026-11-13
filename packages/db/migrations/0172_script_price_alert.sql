-- ADR 0098 § 5: the system alert « prix d'un script changé » (`script_price`), switched per creator like the others.
ALTER TABLE "system_alert_settings" DROP CONSTRAINT "system_alert_settings_code_check";--> statement-breakpoint
ALTER TABLE "system_alert_settings" ADD CONSTRAINT "system_alert_settings_code_check" CHECK ("system_alert_settings"."code" in ('keyword', 'service_request', 'identity_doubt', 'script_price'));
