-- The webhook of a sales feed (ADR 0050 § 3, CRM-01): `sales_feed_webhooks` holds the platform's webhook id and the
-- secret it signs deliveries with, sealed with CREDENTIALS_ENCRYPTION_KEYS; `sales_feed_deliveries` is its inbox, one
-- row per checked delivery id, no line of the register in it (a delivery only wakes the reading by cursor). Both are
-- out of RLS and revoked from the application role: the webhook route and Réglages reach them through withAdmin.
CREATE TABLE "sales_feed_deliveries" (
	"platform" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"position" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sales_feed_deliveries_platform_delivery_id_pk" PRIMARY KEY("platform","delivery_id"),
	CONSTRAINT "sales_feed_deliveries_platform_check" CHECK ("sales_feed_deliveries"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana'))
);
--> statement-breakpoint
CREATE TABLE "sales_feed_webhooks" (
	"platform" text PRIMARY KEY NOT NULL,
	"platform_webhook_id" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"url" text NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_webhooks_platform_check" CHECK ("sales_feed_webhooks"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana'))
);
--> statement-breakpoint
CREATE INDEX "sales_feed_deliveries_received_idx" ON "sales_feed_deliveries" USING btree ("received_at");--> statement-breakpoint
-- The default privileges of init.sql would hand DML to the application role: these two stay with the owner role.
REVOKE ALL ON "sales_feed_webhooks", "sales_feed_deliveries" FROM nirvana_app;
