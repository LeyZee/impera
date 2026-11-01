-- The agency's team (ADR 0023, EQ-01): members, internal notes, commission presets and rates. No `creator_id`: a
-- policy per account instead, read from `app.user_id` and `app.team_scope` that `withMember` sets (owner | agency |
-- self, derived by the server in the transaction). Unset, every policy matches nothing. Additive: four new tables.
CREATE TABLE "commission_presets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_presets_name_from_unique" UNIQUE("name","effective_from"),
	CONSTRAINT "commission_presets_name_check" CHECK (char_length("commission_presets"."name") between 1 and 60),
	CONSTRAINT "commission_presets_rate_check" CHECK ("commission_presets"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "commission_presets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_commission_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"rate_bps" integer NOT NULL,
	"team_share_bps" integer,
	"preset_id" uuid,
	"effective_from" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_commission_rates_member_from_unique" UNIQUE("member_id","effective_from"),
	CONSTRAINT "member_commission_rates_rate_check" CHECK ("member_commission_rates"."rate_bps" between 0 and 10000),
	CONSTRAINT "member_commission_rates_team_share_check" CHECK ("member_commission_rates"."team_share_bps" is null or "member_commission_rates"."team_share_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "member_commission_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_member_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_member_notes_body_check" CHECK (char_length("team_member_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "team_member_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"team_role" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text NOT NULL,
	"country" text NOT NULL,
	"time_zone" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"color" text,
	"joined_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "team_members_team_role_check" CHECK ("team_members"."team_role" in ('chatter', 'manager')),
	CONSTRAINT "team_members_status_check" CHECK ("team_members"."status" in ('active', 'on_leave', 'sick', 'travelling', 'suspended', 'left')),
	CONSTRAINT "team_members_country_check" CHECK ("team_members"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "team_members_color_check" CHECK ("team_members"."color" is null or "team_members"."color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_presets" ADD CONSTRAINT "commission_presets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_commission_rates" ADD CONSTRAINT "member_commission_rates_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_commission_rates" ADD CONSTRAINT "member_commission_rates_preset_id_commission_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."commission_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_commission_rates" ADD CONSTRAINT "member_commission_rates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_notes" ADD CONSTRAINT "team_member_notes_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_notes" ADD CONSTRAINT "team_member_notes_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_member_notes_member_idx" ON "team_member_notes" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE POLICY "team_read" ON "commission_presets" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "commission_presets" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "commission_presets"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "member_commission_rates" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "member_commission_rates"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "member_commission_rates" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "member_commission_rates"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "team_member_notes" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and not exists (select 1 from team_members m where m.id = "team_member_notes"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "team_insert" ON "team_member_notes" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "team_member_notes"."author_user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "team_members" AS PERMISSIVE FOR SELECT TO public USING ("team_members"."user_id" = nullif(current_setting('app.user_id', true), '') or nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "team_members" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "owner_update" ON "team_members" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner');
--> statement-breakpoint
-- Added by hand after `drizzle-kit generate` (ADR 0005, ADR 0023 § Données et RLS).
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_member_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_presets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_commission_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A member is never deleted (his statements and invoices stay): he is marked `left`.
GRANT SELECT, INSERT, UPDATE ON "team_members" TO nirvana_app;--> statement-breakpoint
REVOKE DELETE ON "team_members" FROM nirvana_app;--> statement-breakpoint
-- Notes, presets and rates are facts of the past: a change is a new row, from a date, never an edit.
GRANT SELECT, INSERT ON "team_member_notes", "commission_presets", "member_commission_rates" TO nirvana_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "team_member_notes", "commission_presets", "member_commission_rates" FROM nirvana_app;--> statement-breakpoint
CREATE TRIGGER "team_member_notes_append_only" BEFORE UPDATE OR DELETE ON "team_member_notes"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
CREATE TRIGGER "commission_presets_append_only" BEFORE UPDATE OR DELETE ON "commission_presets"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
CREATE TRIGGER "member_commission_rates_append_only" BEFORE UPDATE OR DELETE ON "member_commission_rates"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();
