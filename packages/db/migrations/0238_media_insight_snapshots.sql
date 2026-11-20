-- ADR 0120 § 2 (amendment of 20/11/2026), INS-01 lot b. Additive. `media_insight_snapshots`: the numbers of one of her
-- Instagram media, one row per media and per age, written once: read inside the window of its age, or kept missed
-- without a number. Numbers only: no caption, no text, no name. Written by the reading job under the app role, one
-- creator at a time (withTenantJob, app.job = 'media_insights'): it reads and inserts, never updates nor deletes.
-- Read by the owner, or an active manager with her on his list; closed to a creator's own account.
CREATE TABLE "media_insight_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"media_ref" text NOT NULL,
	"media_kind" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"age" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"missed" boolean NOT NULL,
	"views" integer,
	"reach" integer,
	"likes" integer,
	"comment_count" integer,
	"shares" integer,
	"saves" integer,
	"reposts" integer,
	"skip_rate" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_insight_snapshots_step_unique" UNIQUE("creator_id","media_ref","age"),
	CONSTRAINT "media_insight_snapshots_media_kind_check" CHECK ("media_insight_snapshots"."media_kind" in ('reel', 'photo', 'carousel')),
	CONSTRAINT "media_insight_snapshots_age_check" CHECK ("media_insight_snapshots"."age" in ('1h', '24h', '48h', '7d')),
	CONSTRAINT "media_insight_snapshots_media_ref_check" CHECK (char_length("media_insight_snapshots"."media_ref") between 1 and 128),
	CONSTRAINT "media_insight_snapshots_missed_check" CHECK (case when "media_insight_snapshots"."missed" then num_nulls("media_insight_snapshots"."views", "media_insight_snapshots"."reach", "media_insight_snapshots"."likes", "media_insight_snapshots"."comment_count", "media_insight_snapshots"."shares", "media_insight_snapshots"."saves", "media_insight_snapshots"."reposts", "media_insight_snapshots"."skip_rate") = 8 else num_nulls("media_insight_snapshots"."views", "media_insight_snapshots"."reach", "media_insight_snapshots"."likes", "media_insight_snapshots"."comment_count", "media_insight_snapshots"."shares", "media_insight_snapshots"."saves") = 0 end),
	CONSTRAINT "media_insight_snapshots_counts_check" CHECK (coalesce("media_insight_snapshots"."views", 0) >= 0 and coalesce("media_insight_snapshots"."reach", 0) >= 0 and coalesce("media_insight_snapshots"."likes", 0) >= 0 and coalesce("media_insight_snapshots"."comment_count", 0) >= 0 and coalesce("media_insight_snapshots"."shares", 0) >= 0 and coalesce("media_insight_snapshots"."saves", 0) >= 0 and coalesce("media_insight_snapshots"."reposts", 0) >= 0),
	CONSTRAINT "media_insight_snapshots_skip_rate_check" CHECK ("media_insight_snapshots"."skip_rate" is null or ("media_insight_snapshots"."media_kind" = 'reel' and "media_insight_snapshots"."skip_rate" between 0 and 1))
);
--> statement-breakpoint
ALTER TABLE "media_insight_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_insight_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_insight_snapshots" ADD CONSTRAINT "media_insight_snapshots_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_insight_snapshots_creator_published_idx" ON "media_insight_snapshots" USING btree ("creator_id","published_at");--> statement-breakpoint
CREATE POLICY "insights_read" ON "media_insight_snapshots" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and "media_insight_snapshots"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "media_insight_snapshots"."creator_id" = any(u.creator_ids)))));--> statement-breakpoint
CREATE POLICY "job_read" ON "media_insight_snapshots" AS PERMISSIVE FOR SELECT TO public USING ("media_insight_snapshots"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'media_insights');--> statement-breakpoint
CREATE POLICY "job_insert" ON "media_insight_snapshots" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("media_insight_snapshots"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'media_insights');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "media_insight_snapshots" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- From nothing, whatever the default privileges gave: a step kept is never changed nor removed by anyone, and the
-- service role only reads.
REVOKE ALL ON "media_insight_snapshots" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "media_insight_snapshots" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "media_insight_snapshots" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "media_insight_snapshots" TO impera_service;
