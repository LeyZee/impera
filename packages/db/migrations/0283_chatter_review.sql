CREATE TABLE "chatter_fault_explanations" (
	"creator_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"fault_code" text NOT NULL,
	"remark_id" uuid NOT NULL,
	"explained_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatter_fault_explanations_creator_id_member_id_fault_code_pk" PRIMARY KEY("creator_id","member_id","fault_code")
);
--> statement-breakpoint
ALTER TABLE "chatter_fault_explanations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chatter_fault_levels" (
	"fault_code" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"label" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatter_fault_levels_level_check" CHECK ("chatter_fault_levels"."level" in ('advice', 'standard', 'firm', 'owner_alert')),
	CONSTRAINT "chatter_fault_levels_code_check" CHECK ("chatter_fault_levels"."fault_code" ~ '^fault\.[a-z0-9_]{1,60}$'),
	CONSTRAINT "chatter_fault_levels_label_check" CHECK (char_length("chatter_fault_levels"."label") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "chatter_fault_levels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chatter_remark_contests" (
	"remark_id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"said_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatter_remark_contests_reason_check" CHECK (char_length("chatter_remark_contests"."reason") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "chatter_remark_contests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chatter_remark_rulings" (
	"remark_id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"ruling" text NOT NULL,
	"said_by" text NOT NULL,
	"said_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chatter_remark_rulings_ruling_check" CHECK ("chatter_remark_rulings"."ruling" in ('upheld', 'dropped'))
);
--> statement-breakpoint
ALTER TABLE "chatter_remark_rulings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chatter_fault_explanations" ADD CONSTRAINT "chatter_fault_explanations_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_fault_explanations" ADD CONSTRAINT "chatter_fault_explanations_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_fault_explanations" ADD CONSTRAINT "chatter_fault_explanations_fault_code_chatter_fault_levels_fault_code_fk" FOREIGN KEY ("fault_code") REFERENCES "public"."chatter_fault_levels"("fault_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_fault_levels" ADD CONSTRAINT "chatter_fault_levels_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_remark_contests" ADD CONSTRAINT "chatter_remark_contests_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_remark_contests" ADD CONSTRAINT "chatter_remark_contests_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_remark_rulings" ADD CONSTRAINT "chatter_remark_rulings_remark_id_chatter_remark_contests_remark_id_fk" FOREIGN KEY ("remark_id") REFERENCES "public"."chatter_remark_contests"("remark_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_remark_rulings" ADD CONSTRAINT "chatter_remark_rulings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatter_remark_rulings" ADD CONSTRAINT "chatter_remark_rulings_said_by_user_id_fk" FOREIGN KEY ("said_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "member_read" ON "chatter_fault_explanations" AS PERMISSIVE FOR SELECT TO public USING ("chatter_fault_explanations"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and ((nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "chatter_fault_explanations"."creator_id" = any(u.creator_ids)))) or exists (select 1 from team_members m where m.id = "chatter_fault_explanations"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "member_insert" ON "chatter_fault_explanations" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("chatter_fault_explanations"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from team_members m where m.id = "chatter_fault_explanations"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "chatter_fault_explanations"."explained_at" = now());--> statement-breakpoint
CREATE POLICY "team_read" ON "chatter_fault_levels" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "chatter_fault_levels" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "chatter_fault_levels"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "chatter_fault_levels" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "chatter_fault_levels"."updated_by" = nullif(current_setting('app.user_id', true), '') and "chatter_fault_levels"."updated_at" = now());--> statement-breakpoint
CREATE POLICY "member_read" ON "chatter_remark_contests" AS PERMISSIVE FOR SELECT TO public USING ("chatter_remark_contests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and ((nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "chatter_remark_contests"."creator_id" = any(u.creator_ids)))) or exists (select 1 from team_members m where m.id = "chatter_remark_contests"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "member_insert" ON "chatter_remark_contests" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("chatter_remark_contests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from team_members m where m.id = "chatter_remark_contests"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "chatter_remark_contests"."said_at" = now());--> statement-breakpoint
CREATE POLICY "member_read" ON "chatter_remark_rulings" AS PERMISSIVE FOR SELECT TO public USING ("chatter_remark_rulings"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from chatter_remark_contests c where c.remark_id = "chatter_remark_rulings"."remark_id"));--> statement-breakpoint
CREATE POLICY "manager_insert" ON "chatter_remark_rulings" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("chatter_remark_rulings"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "chatter_remark_rulings"."creator_id" = any(u.creator_ids)))) and "chatter_remark_rulings"."said_by" = nullif(current_setting('app.user_id', true), '') and "chatter_remark_rulings"."said_at" = now() and exists (select 1 from chatter_remark_contests c where c.remark_id = "chatter_remark_rulings"."remark_id" and c.creator_id = "chatter_remark_rulings"."creator_id" and not exists (select 1 from team_members m where m.id = c.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- The chatter's review, the `team` side (ADR 0170 §§ 14, 28 and 29). Forced, so that even the tables' owner goes
-- through RLS. No level nor label here: the owner saves them, out of the repository.
ALTER TABLE "chatter_fault_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chatter_fault_explanations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chatter_remark_contests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chatter_remark_rulings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- What a chatter was told, what he contested and what was decided are never undone nor deleted.
CREATE TRIGGER "chatter_fault_explanations_append_only" BEFORE UPDATE OR DELETE ON "chatter_fault_explanations"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
CREATE TRIGGER "chatter_remark_contests_append_only" BEFORE UPDATE OR DELETE ON "chatter_remark_contests"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
CREATE TRIGGER "chatter_remark_rulings_append_only" BEFORE UPDATE OR DELETE ON "chatter_remark_rulings"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the triggers).
REVOKE ALL ON "chatter_fault_levels" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "chatter_fault_levels" FROM impera_service;--> statement-breakpoint
REVOKE ALL ON "chatter_fault_explanations" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "chatter_fault_explanations" FROM impera_service;--> statement-breakpoint
REVOKE ALL ON "chatter_remark_contests" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "chatter_remark_contests" FROM impera_service;--> statement-breakpoint
REVOKE ALL ON "chatter_remark_rulings" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "chatter_remark_rulings" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "chatter_fault_levels" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "chatter_fault_explanations" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "chatter_remark_contests" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "chatter_remark_rulings" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "chatter_fault_levels" TO impera_service;--> statement-breakpoint
GRANT SELECT ON "chatter_fault_explanations" TO impera_service;--> statement-breakpoint
GRANT SELECT ON "chatter_remark_contests" TO impera_service;--> statement-breakpoint
GRANT SELECT ON "chatter_remark_rulings" TO impera_service;
