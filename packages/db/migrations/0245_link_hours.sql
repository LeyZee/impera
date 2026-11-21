-- ADR 0120 § 3, INS-02 lot e2. Additive. `redirect_links.service_ref`: how the redirect service names a link, kept
-- once the owner attached it; read by the server at the service, never taken from a browser; one link of the service
-- belongs to one creator. `redirect_link_hours`: the hours kept of a link, totals only (page views without the robots,
-- clicks, robots beside), one row per link and per hour UTC, zero included. Written by the hourly job under the app
-- role, one creator at a time (withTenantJob, app.job = 'link_hours'); an hour closed is frozen by the job's own
-- update policy. Read by the owner, or an active manager with her on his list; closed to a creator's own account.
CREATE TABLE "redirect_link_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"pageviews" integer NOT NULL,
	"clicks" integer NOT NULL,
	"robots" integer NOT NULL,
	"closed" boolean NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirect_link_hours_link_hour_unique" UNIQUE("link_id","hour"),
	CONSTRAINT "redirect_link_hours_hour_check" CHECK (extract(epoch from "redirect_link_hours"."hour")::bigint % 3600 = 0),
	CONSTRAINT "redirect_link_hours_counts_check" CHECK ("redirect_link_hours"."pageviews" >= 0 and "redirect_link_hours"."clicks" >= 0 and "redirect_link_hours"."robots" >= 0),
	CONSTRAINT "redirect_link_hours_closed_check" CHECK (not "redirect_link_hours"."closed" or "redirect_link_hours"."read_at" >= "redirect_link_hours"."hour" + interval '1 hour')
);
--> statement-breakpoint
ALTER TABLE "redirect_link_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "redirect_link_hours" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "redirect_links" ADD COLUMN "service_ref" text;--> statement-breakpoint
ALTER TABLE "redirect_links" ADD CONSTRAINT "redirect_links_service_ref_unique" UNIQUE("service_ref");--> statement-breakpoint
ALTER TABLE "redirect_links" ADD CONSTRAINT "redirect_links_id_creator_unique" UNIQUE("id","creator_id");--> statement-breakpoint
ALTER TABLE "redirect_link_hours" ADD CONSTRAINT "redirect_link_hours_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect_link_hours" ADD CONSTRAINT "redirect_link_hours_link_creator_fk" FOREIGN KEY ("link_id","creator_id") REFERENCES "public"."redirect_links"("id","creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redirect_link_hours_creator_hour_idx" ON "redirect_link_hours" USING btree ("creator_id","hour");--> statement-breakpoint
ALTER TABLE "redirect_links" ADD CONSTRAINT "redirect_links_service_ref_check" CHECK ("redirect_links"."service_ref" is null or "redirect_links"."service_ref" ~ '^[a-z]{2,8}_[0-9a-f]{16,40}$');--> statement-breakpoint
CREATE POLICY "owner_attach" ON "redirect_links" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "redirect_links"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "redirect_links"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "job_read" ON "redirect_links" AS PERMISSIVE FOR SELECT TO public USING ("redirect_links"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'link_hours');--> statement-breakpoint
CREATE POLICY "hours_read" ON "redirect_link_hours" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and "redirect_link_hours"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "redirect_link_hours"."creator_id" = any(u.creator_ids)))));--> statement-breakpoint
CREATE POLICY "job_read" ON "redirect_link_hours" AS PERMISSIVE FOR SELECT TO public USING ("redirect_link_hours"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'link_hours');--> statement-breakpoint
CREATE POLICY "job_insert" ON "redirect_link_hours" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("redirect_link_hours"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'link_hours');--> statement-breakpoint
CREATE POLICY "job_update" ON "redirect_link_hours" AS PERMISSIVE FOR UPDATE TO public USING ("redirect_link_hours"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'link_hours' and not "redirect_link_hours"."closed") WITH CHECK ("redirect_link_hours"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'link_hours');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "redirect_link_hours" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- From nothing, whatever the default privileges gave: nobody removes an hour, and the service role only reads.
REVOKE ALL ON "redirect_link_hours" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "redirect_link_hours" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "redirect_link_hours" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "redirect_link_hours" TO impera_service;--> statement-breakpoint
-- The owner's policy opens the row; the grant keeps it to the one column the attachment writes, and its date.
GRANT UPDATE ("service_ref", "updated_at") ON "redirect_links" TO nirvana_app;
