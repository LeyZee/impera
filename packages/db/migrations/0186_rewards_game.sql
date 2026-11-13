-- ADR 0104 § 12 to § 20 (CHF-01, lot 2a): what a chatter earned in the game, their streak, and an account's own
-- preferences. reward_gains and reward_streaks are written by the job `rewards.evaluate` alone (withAdmin); the
-- application reads them (the account its own, the owner and the managers the team's) and changes one column,
-- revealed_at, of its own gains. Nothing is deleted. Nothing here enters a statement (§ 17).
-- user_preferences: one row an account, read and written by that account alone; no row means the defaults.
CREATE TABLE "reward_gains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"scope_key" text DEFAULT '' NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"revealed_at" timestamp with time zone,
	CONSTRAINT "reward_gains_once" UNIQUE("user_id","kind","scope_key"),
	CONSTRAINT "reward_gains_kind_check" CHECK ("reward_gains"."kind" in ('tier', 'first_sale', 'day_record', 'fortnight_record', 'fortnight_on_time', 'streak_5', 'streak_10', 'streak_25', 'ten_ppv_shift')),
	CONSTRAINT "reward_gains_scope_check" CHECK (("reward_gains"."kind" = 'tier') = ("reward_gains"."scope_key" <> '')),
	CONSTRAINT "reward_gains_reveal_check" CHECK ("reward_gains"."revealed_at" is null or "reward_gains"."revealed_at" >= "reward_gains"."earned_at")
);
--> statement-breakpoint
ALTER TABLE "reward_gains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reward_gains" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Where the default privileges of init.sql already gave the rest (the dev database): read, and the reveal alone.
REVOKE ALL ON "reward_gains" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "reward_gains" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("revealed_at") ON "reward_gains" TO nirvana_app;--> statement-breakpoint
CREATE TABLE "reward_streaks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"current" integer NOT NULL,
	"best" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_streaks_count_check" CHECK ("reward_streaks"."current" >= 0 and "reward_streaks"."best" >= "reward_streaks"."current")
);
--> statement-breakpoint
ALTER TABLE "reward_streaks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reward_streaks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "reward_streaks" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "reward_streaks" TO nirvana_app;--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sounds_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "user_preferences" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "user_preferences" TO nirvana_app;--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_streaks" ADD CONSTRAINT "reward_streaks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_gains_user_idx" ON "reward_gains" USING btree ("user_id","earned_at");--> statement-breakpoint
CREATE POLICY "own_read" ON "reward_gains" AS PERMISSIVE FOR SELECT TO public USING ("reward_gains"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "reward_gains" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "own_reveal" ON "reward_gains" AS PERMISSIVE FOR UPDATE TO public USING ("reward_gains"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("reward_gains"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_read" ON "reward_streaks" AS PERMISSIVE FOR SELECT TO public USING ("reward_streaks"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "reward_streaks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "own_read" ON "user_preferences" AS PERMISSIVE FOR SELECT TO public USING ("user_preferences"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_insert" ON "user_preferences" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("user_preferences"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "own_update" ON "user_preferences" AS PERMISSIVE FOR UPDATE TO public USING ("user_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("user_preferences"."user_id" = nullif(current_setting('app.user_id', true), ''));