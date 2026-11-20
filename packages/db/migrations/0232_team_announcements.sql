CREATE TABLE "announcement_reads" (
	"announcement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_reads_announcement_id_member_id_pk" PRIMARY KEY("announcement_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "announcement_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid,
	"body" text NOT NULL,
	"author_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	CONSTRAINT "announcements_body_check" CHECK (char_length("announcements"."body") between 1 and 1000),
	CONSTRAINT "announcements_withdrawn_check" CHECK (("announcements"."withdrawn_at" is null) = ("announcements"."withdrawn_by" is null))
);
--> statement-breakpoint
ALTER TABLE "announcements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_reads_member_idx" ON "announcement_reads" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "announcements_created_idx" ON "announcements" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "member_read" ON "announcement_reads" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "announcement_reads"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_insert" ON "announcement_reads" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("announcement_reads"."read_at" = now() and exists (select 1 from team_members m where m.id = "announcement_reads"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '') and m.status <> 'left') and exists (select 1 from announcements a where a.id = "announcement_reads"."announcement_id" and a.withdrawn_at is null));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "announcement_reads" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "team_read" ON "announcements" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or (nullif(current_setting('app.team_scope', true), '') = 'self' and "announcements"."withdrawn_at" is null and ("announcements"."creator_id" is null or exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "announcements"."creator_id" = any(u.creator_ids)))));--> statement-breakpoint
CREATE POLICY "team_insert" ON "announcements" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("announcements"."author_user_id" = nullif(current_setting('app.user_id', true), '') and "announcements"."withdrawn_at" is null and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and ("announcements"."creator_id" is null or exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "announcements"."creator_id" = any(u.creator_ids))))));--> statement-breakpoint
CREATE POLICY "team_withdraw" ON "announcements" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "announcements"."withdrawn_at" is null) WITH CHECK ("announcements"."withdrawn_by" = nullif(current_setting('app.user_id', true), '') and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and "announcements"."author_user_id" = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "announcements" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Annonces (EQ-12): written by the owner and the active managers, read by those they are addressed to, « Lu » by each
-- member once; never deleted nor edited, withdrawn only. Forced, so that even the tables' owner goes through RLS.
ALTER TABLE "announcements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "announcement_reads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app reads and writes, sets only the withdrawal, deletes none.
REVOKE ALL ON "announcements" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "announcement_reads" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "announcements" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("withdrawn_at", "withdrawn_by") ON "announcements" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "announcement_reads" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "announcements" TO impera_service;--> statement-breakpoint
GRANT SELECT ON "announcement_reads" TO impera_service;
