-- Push notifications (CR-01 lot b, ADR 0042 § 7). `push_server_keys` holds the server's VAPID key pair, made at the
-- first start, the private key sealed with CREDENTIALS_ENCRYPTION_KEYS, out of RLS and revoked from the application
-- role like every other secret (ADR 0016 § 3). `push_subscriptions` (one row per device) and `notification_preferences`
-- (quiet hours and daily cap) belong to one account each: RLS forced, each account reads and writes only its own.
-- `notification_deliveries` records every notification asked for an account once (unique account, reason, object),
-- with what was decided; never deleted by the application (no DELETE grant), gone with the account.
-- Additive: no existing row is touched.
CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"quiet_start_minute" smallint NOT NULL,
	"quiet_end_minute" smallint NOT NULL,
	"daily_cap" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_minutes_check" CHECK ("notification_preferences"."quiet_start_minute" between 0 and 1439 and "notification_preferences"."quiet_end_minute" between 0 and 1439),
	CONSTRAINT "notification_preferences_cap_check" CHECK ("notification_preferences"."daily_cap" between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_server_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_key" "bytea" NOT NULL,
	"private_key_ciphertext" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"server_key_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_server_key_id_push_server_keys_id_fk" FOREIGN KEY ("server_key_id") REFERENCES "public"."push_server_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "own_rows" ON "notification_preferences" AS PERMISSIVE FOR ALL TO public USING ("notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("notification_preferences"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_rows" ON "push_subscriptions" AS PERMISSIVE FOR ALL TO public USING ("push_subscriptions"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("push_subscriptions"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"object_key" text NOT NULL,
	"decision" text NOT NULL,
	"local_day" text NOT NULL,
	"hold_until" timestamp with time zone,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_once" UNIQUE("user_id","reason","object_key"),
	CONSTRAINT "notification_deliveries_decision_check" CHECK ("notification_deliveries"."decision" in ('rang', 'held', 'grouped', 'silent', 'recapped')),
	CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'reminder', 'routine', 'streak', 'team'))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_decided_idx" ON "notification_deliveries" USING btree ("user_id","decided_at");--> statement-breakpoint
CREATE POLICY "own_rows" ON "notification_deliveries" AS PERMISSIVE FOR ALL TO public USING ("notification_deliveries"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("notification_deliveries"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "push_server_keys" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscriptions", "notification_preferences" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification_deliveries" TO nirvana_app;
