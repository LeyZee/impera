-- Push notifications (CR-01 lot b, ADR 0042 § 7). `push_server_keys` holds the server's VAPID key pair, made at the
-- first start, the private key sealed with CREDENTIALS_ENCRYPTION_KEYS, out of RLS and revoked from the application
-- role like every other secret (ADR 0016 § 3). `push_subscriptions` (one row per device) and `notification_preferences`
-- (quiet hours and daily cap) belong to one account each: RLS forced, each account reads and writes only its own.
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
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "push_server_keys" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscriptions", "notification_preferences" TO nirvana_app;
