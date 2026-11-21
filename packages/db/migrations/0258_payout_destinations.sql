CREATE TABLE "payout_destinations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"method" text NOT NULL,
	"details_ciphertext" "bytea" NOT NULL,
	"resealed" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_destinations_method_check" CHECK ("payout_destinations"."method" in ('mobile_money', 'bank_account', 'cash_pickup')),
	CONSTRAINT "payout_destinations_size_check" CHECK (octet_length("payout_destinations"."details_ciphertext") between 1 and 4096)
);
--> statement-breakpoint
ALTER TABLE "payout_destinations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_reason_check";--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payout_destinations_member_idx" ON "payout_destinations" USING btree ("member_id","created_at");--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'own_shift_end', 'reminder', 'routine', 'streak', 'team', 'agency_share', 'creator_alert', 'safety_alert', 'owner_change', 'payout_change'));--> statement-breakpoint
CREATE POLICY "owner_or_self_select" ON "payout_destinations" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' or exists (select 1 from team_members m where m.id = "payout_destinations"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "self_insert" ON "payout_destinations" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (select 1 from team_members m where m.id = "payout_destinations"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "payout_destinations"."created_by" = nullif(current_setting('app.user_id', true), '') and not "payout_destinations"."resealed" and "payout_destinations"."created_at" = now());--> statement-breakpoint
-- « Où te verser » (ADR 0165): one version per change, never changed nor deleted; a key rotation adds a version marked
-- `resealed` through the admin role. Forced, so that even the table's owner goes through RLS. `notification_deliveries`
-- takes the reason `payout_change` (ADR 0165 § 5).
ALTER TABLE "payout_destinations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "payout_destinations_append_only" BEFORE UPDATE OR DELETE ON "payout_destinations"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the trigger). No
-- grant to the service role, a wanted exception (ADR 0165 § 4): it never reads where a member is paid.
REVOKE ALL ON "payout_destinations" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "payout_destinations" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "payout_destinations" TO nirvana_app;
