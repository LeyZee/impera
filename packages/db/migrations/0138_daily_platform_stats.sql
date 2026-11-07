-- ADR 0081: the platform's statistics of each creator account's day (counters only, never an amount), and the calls
-- made to the platform's statistics on each of its days, counted before each call. Both are written by the hourly
-- reading through withAdmin alone: nirvana_app reads the photo inside withTenantMember (the owner, or an active
-- manager on whose list she is), writes neither table and has no right at all on the calls counted.
CREATE TABLE "platform_daily_stats" (
	"platform" text NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"day" date NOT NULL,
	"new_subscribers" integer NOT NULL,
	"unsubscribes" integer,
	"active_subscribers" integer NOT NULL,
	"renewals" integer,
	"ppv_sent" integer,
	"ppv_purchased" integer NOT NULL,
	"messages_sent" integer,
	"messages_received" integer,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_daily_stats_pk" PRIMARY KEY("platform_account_id","day"),
	CONSTRAINT "platform_daily_stats_platform_check" CHECK ("platform_daily_stats"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "platform_daily_stats_counts_check" CHECK ("platform_daily_stats"."new_subscribers" >= 0 and "platform_daily_stats"."active_subscribers" >= 0 and "platform_daily_stats"."ppv_purchased" >= 0 and coalesce("platform_daily_stats"."unsubscribes", 0) >= 0 and coalesce("platform_daily_stats"."renewals", 0) >= 0 and coalesce("platform_daily_stats"."ppv_sent", 0) >= 0 and coalesce("platform_daily_stats"."messages_sent", 0) >= 0 and coalesce("platform_daily_stats"."messages_received", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "platform_daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_daily_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "platform_daily_stats" TO nirvana_app;--> statement-breakpoint
-- Where the default privileges of init.sql already gave the rest (the dev database): read only.
REVOKE INSERT, UPDATE, DELETE ON "platform_daily_stats" FROM nirvana_app;--> statement-breakpoint
CREATE TABLE "sales_feed_stats_calls" (
	"platform" text NOT NULL,
	"day" date NOT NULL,
	"calls" integer NOT NULL,
	CONSTRAINT "sales_feed_stats_calls_pk" PRIMARY KEY("platform","day"),
	CONSTRAINT "sales_feed_stats_calls_platform_check" CHECK ("sales_feed_stats_calls"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "sales_feed_stats_calls_calls_check" CHECK ("sales_feed_stats_calls"."calls" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales_feed_stats_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_feed_stats_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "sales_feed_stats_calls" FROM nirvana_app;--> statement-breakpoint
ALTER TABLE "sales_feed_cursors" ADD COLUMN "stats_full_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_daily_stats" ADD CONSTRAINT "platform_daily_stats_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_daily_stats" ADD CONSTRAINT "platform_daily_stats_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_daily_stats_creator_day_idx" ON "platform_daily_stats" USING btree ("creator_id","day");--> statement-breakpoint
CREATE POLICY "stats_read" ON "platform_daily_stats" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and "platform_daily_stats"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "platform_daily_stats"."creator_id" = any(u.creator_ids)))));