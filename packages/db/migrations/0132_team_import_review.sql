-- ADR 0076: the team imported from the platform after review. `sales_feed_chatter_reviews` keeps, per account of the
-- platform's team, the decision on an account without a link (`none` confirmed, `dismissed` set aside) and what the
-- reading of the list saw (its `removedAt`, its `isBot`, and since when a believed reading no longer lists it): a
-- removal is an alert as long as it lasts, never a deletion. `sales_feed_team_readings` keeps the last reading of each
-- platform's list (how many accounts, believed or not). Agency-level, closed to a creator's own account; rows are
-- updated, never deleted, so the application role gets no DELETE.
-- `sales_feed_chatters` gets restrictive policies: a manager never poses, moves or undoes a link to his own member
-- record (§ 4); the owner may. The team's insert policies get a `manager_invite` beside `owner_insert` (§ 3): an
-- active manager creates a chatter, never himself, with his first role `chatter` and a preset of the owner as it is in
-- effect, from the day he joins; every later change stays the owner's (ADR 0024 § Rôles).
CREATE TABLE "sales_feed_chatter_reviews" (
	"platform" text NOT NULL,
	"platform_chatter_id" text NOT NULL,
	"decision" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"platform_removed_at" timestamp with time zone,
	"absent_since" timestamp with time zone,
	"is_bot" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_chatter_reviews_pk" PRIMARY KEY("platform","platform_chatter_id"),
	CONSTRAINT "sales_feed_chatter_reviews_platform_check" CHECK ("sales_feed_chatter_reviews"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "sales_feed_chatter_reviews_decision_check" CHECK ("sales_feed_chatter_reviews"."decision" in ('none', 'dismissed')),
	CONSTRAINT "sales_feed_chatter_reviews_decided_check" CHECK (("sales_feed_chatter_reviews"."decision" is null) = ("sales_feed_chatter_reviews"."decided_at" is null)),
	CONSTRAINT "sales_feed_chatter_reviews_id_check" CHECK (char_length("sales_feed_chatter_reviews"."platform_chatter_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "sales_feed_chatter_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_feed_chatter_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_feed_chatter_reviews" TO nirvana_app;--> statement-breakpoint
CREATE TABLE "sales_feed_team_readings" (
	"platform" text PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"listed" integer NOT NULL,
	"abnormal" boolean NOT NULL,
	CONSTRAINT "sales_feed_team_readings_platform_check" CHECK ("sales_feed_team_readings"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "sales_feed_team_readings_listed_check" CHECK ("sales_feed_team_readings"."listed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales_feed_team_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_feed_team_readings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_feed_team_readings" TO nirvana_app;--> statement-breakpoint
CREATE POLICY "not_own_link_insert" ON "sales_feed_chatters" AS RESTRICTIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and ("sales_feed_chatters"."member_id" is null or not exists (select 1 from team_members m where m.id = "sales_feed_chatters"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')))));--> statement-breakpoint
CREATE POLICY "not_own_link_update" ON "sales_feed_chatters" AS RESTRICTIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and ("sales_feed_chatters"."member_id" is null or not exists (select 1 from team_members m where m.id = "sales_feed_chatters"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))))) WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and ("sales_feed_chatters"."member_id" is null or not exists (select 1 from team_members m where m.id = "sales_feed_chatters"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')))));--> statement-breakpoint
CREATE POLICY "not_own_link_delete" ON "sales_feed_chatters" AS RESTRICTIVE FOR DELETE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and ("sales_feed_chatters"."member_id" is null or not exists (select 1 from team_members m where m.id = "sales_feed_chatters"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')))));--> statement-breakpoint
CREATE POLICY "manager_invite" ON "member_commission_rates" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'agency' and "member_commission_rates"."created_by" = nullif(current_setting('app.user_id', true), '') and "member_commission_rates"."team_share_bps" is null and exists (select 1 from team_members m where m.id = "member_commission_rates"."member_id" and m.team_role = 'chatter' and m.user_id <> nullif(current_setting('app.user_id', true), '') and m.joined_on = "member_commission_rates"."effective_from" and m.created_at = now()) and exists (select 1 from commission_presets p where p.id = "member_commission_rates"."preset_id" and p.rate_bps = "member_commission_rates"."rate_bps" and p.effective_from <= "member_commission_rates"."effective_from" and not exists (select 1 from commission_presets q where q.name = p.name and q.effective_from > p.effective_from and q.effective_from <= "member_commission_rates"."effective_from")));--> statement-breakpoint
CREATE POLICY "manager_invite" ON "member_roles" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'agency' and "member_roles"."created_by" = nullif(current_setting('app.user_id', true), '') and "member_roles"."team_role" = 'chatter' and exists (select 1 from team_members m where m.id = "member_roles"."member_id" and m.team_role = 'chatter' and m.user_id <> nullif(current_setting('app.user_id', true), '') and m.joined_on = "member_roles"."effective_from" and m.created_at = now()));--> statement-breakpoint
CREATE POLICY "manager_invite" ON "team_members" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'agency' and "team_members"."team_role" = 'chatter' and "team_members"."user_id" <> nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "agency_only" ON "sales_feed_chatter_reviews" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "agency_only" ON "sales_feed_team_readings" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');