-- ADR 0092 § 1 (CRM-05): the platform's statistics of each member of its team on each creator account's day (PPV sent
-- and bought, messages; never an amount nor a fan), written by the hourly reading of ADR 0081 through withAdmin alone,
-- as platform_daily_stats: nirvana_app reads it inside withTenantMember (the owner, or an active manager on whose list
-- she is) and writes nothing.
CREATE TABLE "platform_chatter_daily_stats" (
	"platform" text NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_chatter_id" text NOT NULL,
	"day" date NOT NULL,
	"ppv_sent" integer,
	"ppv_purchased" integer NOT NULL,
	"messages_sent" integer,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_chatter_daily_stats_pk" PRIMARY KEY("platform_account_id","platform_chatter_id","day"),
	CONSTRAINT "platform_chatter_daily_stats_platform_check" CHECK ("platform_chatter_daily_stats"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "platform_chatter_daily_stats_counts_check" CHECK ("platform_chatter_daily_stats"."ppv_purchased" >= 0 and coalesce("platform_chatter_daily_stats"."ppv_sent", 0) >= 0 and coalesce("platform_chatter_daily_stats"."messages_sent", 0) >= 0)
);
--> statement-breakpoint
ALTER TABLE "platform_chatter_daily_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_chatter_daily_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "platform_chatter_daily_stats" TO nirvana_app;--> statement-breakpoint
-- Where the default privileges of init.sql already gave the rest (the dev database): read only.
REVOKE INSERT, UPDATE, DELETE ON "platform_chatter_daily_stats" FROM nirvana_app;--> statement-breakpoint
ALTER TABLE "platform_chatter_daily_stats" ADD CONSTRAINT "platform_chatter_daily_stats_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_chatter_daily_stats" ADD CONSTRAINT "platform_chatter_daily_stats_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_chatter_daily_stats_creator_day_idx" ON "platform_chatter_daily_stats" USING btree ("creator_id","day");--> statement-breakpoint
CREATE POLICY "chatter_stats_read" ON "platform_chatter_daily_stats" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and "platform_chatter_daily_stats"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "platform_chatter_daily_stats"."creator_id" = any(u.creator_ids)))));