-- A member's team role from a date (Charles, 28/10/2026): a change of role starts on the 1st or the 16th of a month,
-- today at the earliest, like a new rate, so that pay reads one role per period. Additive: one new table, append-only
-- like `member_commission_rates`, under the same policies; `team_members.team_role` stays the role of today.
CREATE TABLE "member_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"team_role" text NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_roles_member_from_unique" UNIQUE("member_id","effective_from"),
	CONSTRAINT "member_roles_team_role_check" CHECK ("member_roles"."team_role" in ('chatter', 'manager'))
);
--> statement-breakpoint
ALTER TABLE "member_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "member_read" ON "member_roles" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "member_roles"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "member_roles" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "member_roles"."created_by" = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
-- Added by hand after `drizzle-kit generate` (ADR 0005, ADR 0023 § Données et RLS), as 0015 does for the rates.
ALTER TABLE "member_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "member_roles" TO nirvana_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "member_roles" FROM nirvana_app;--> statement-breakpoint
CREATE TRIGGER "member_roles_append_only" BEFORE UPDATE OR DELETE ON "member_roles"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- Each member's role so far, from the day he joined, signed by whoever wrote his first rate (the owner who added him).
-- A member without any rate, which the API never makes, gets no row: his role is read on his record.
INSERT INTO "member_roles" ("id", "member_id", "team_role", "effective_from", "created_by")
SELECT gen_random_uuid(), m."id", m."team_role", m."joined_on", first_rate."created_by"
FROM "team_members" m
JOIN LATERAL (
  SELECT c."created_by" FROM "member_commission_rates" c
  WHERE c."member_id" = m."id" ORDER BY c."effective_from", c."created_at" LIMIT 1
) first_rate ON true;
