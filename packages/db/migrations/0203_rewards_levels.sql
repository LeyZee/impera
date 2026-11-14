-- ADR 0104 § 14, § 16 and § 20 (CHF-01, lot 2b): the levels. reward_level_settings holds the owner's setting, the
-- cumulated net that opens each rank: one row at most, written by the owner, read by the team (a chatter sees the
-- rank ahead) and by the job `rewards.evaluate`, which notes a rank reached as a gain of kind 'level' (scope_key =
-- the rank). A rank noted is never taken back. Nothing here enters a statement (§ 17).
CREATE TABLE "reward_level_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"thresholds_minor" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_level_settings_singleton_check" CHECK ("reward_level_settings"."singleton"),
	CONSTRAINT "reward_level_settings_array_check" CHECK (jsonb_typeof("reward_level_settings"."thresholds_minor") = 'array')
);
--> statement-breakpoint
ALTER TABLE "reward_level_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reward_level_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Where the default privileges of init.sql already gave the rest (the dev database): read, add and change; never delete.
REVOKE ALL ON "reward_level_settings" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "reward_level_settings" TO nirvana_app;--> statement-breakpoint
-- The job reads the thresholds under the service role (ADR 0087); it never writes them.
GRANT SELECT ON "reward_level_settings" TO impera_service;--> statement-breakpoint
ALTER TABLE "reward_gains" DROP CONSTRAINT "reward_gains_kind_check";--> statement-breakpoint
ALTER TABLE "reward_gains" DROP CONSTRAINT "reward_gains_scope_check";--> statement-breakpoint
ALTER TABLE "reward_level_settings" ADD CONSTRAINT "reward_level_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_kind_check" CHECK ("reward_gains"."kind" in ('tier', 'level', 'first_sale', 'day_record', 'fortnight_record', 'fortnight_on_time', 'streak_5', 'streak_10', 'streak_25', 'ten_ppv_shift'));--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_scope_check" CHECK (("reward_gains"."kind" in ('tier', 'level')) = ("reward_gains"."scope_key" <> ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "reward_level_settings" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.user_id', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "reward_level_settings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "owner_update" ON "reward_level_settings" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner');