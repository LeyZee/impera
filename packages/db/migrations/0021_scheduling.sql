-- The planning (ADR 0023, ADR 0025, EQ-02): settings, weekly templates and shifts. Shifts and templates carry
-- `creator_id` and `member_id`; their policies ask for the creator of `withTenant` and for the member themselves or the
-- scope `owner` | `agency` of `withMember` (`withTenantMember` sets the three). Additive: three new tables, and a
-- unique key on `platform_accounts (id, creator_id)` for their composite foreign keys.
-- First, the target of the composite keys below (Drizzle writes it after them).
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_id_creator_unique" UNIQUE("id","creator_id");--> statement-breakpoint
CREATE TABLE "scheduling_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"time_zone" text NOT NULL,
	"slot_start_minute" integer NOT NULL,
	"slot_length_minutes" integer NOT NULL,
	"access_margin_minutes" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_settings_single_check" CHECK ("scheduling_settings"."id" = 1),
	CONSTRAINT "scheduling_settings_slots_check" CHECK ("scheduling_settings"."slot_length_minutes" in (60, 120, 180, 240, 360, 480, 720) and "scheduling_settings"."slot_start_minute" >= 0 and "scheduling_settings"."slot_start_minute" < "scheduling_settings"."slot_length_minutes"),
	CONSTRAINT "scheduling_settings_margin_check" CHECK ("scheduling_settings"."access_margin_minutes" between 0 and 120)
);
--> statement-breakpoint
ALTER TABLE "scheduling_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_templates_weekday_check" CHECK ("shift_templates"."weekday" between 1 and 7),
	CONSTRAINT "shift_templates_minutes_check" CHECK ("shift_templates"."start_minute" between 0 and 1439 and "shift_templates"."end_minute" between 0 and 1439 and "shift_templates"."start_minute" <> "shift_templates"."end_minute"),
	CONSTRAINT "shift_templates_length_check" CHECK (("shift_templates"."end_minute" - "shift_templates"."start_minute" + 1440) % 1440 <= 1380),
	CONSTRAINT "shift_templates_validity_check" CHECK ("shift_templates"."valid_until" is null or "shift_templates"."valid_until" >= "shift_templates"."valid_from" - 1)
);
--> statement-breakpoint
ALTER TABLE "shift_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"template_id" uuid,
	"template_starts_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_template_occurrence_unique" UNIQUE("template_id","template_starts_at"),
	CONSTRAINT "shifts_range_check" CHECK ("shifts"."ends_at" > "shifts"."starts_at" and "shifts"."ends_at" - "shifts"."starts_at" <= interval '24 hours'),
	CONSTRAINT "shifts_whole_minutes_check" CHECK (date_trunc('minute', "shifts"."starts_at") = "shifts"."starts_at" and date_trunc('minute', "shifts"."ends_at") = "shifts"."ends_at"),
	CONSTRAINT "shifts_stopped_check" CHECK ("shifts"."stopped_at" is null or "shifts"."ends_at" = date_trunc('minute', "shifts"."stopped_at")),
	CONSTRAINT "shifts_template_check" CHECK (("shifts"."template_id" is null) = ("shifts"."template_starts_at" is null))
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scheduling_settings" ADD CONSTRAINT "scheduling_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_template_id_shift_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_templates_creator_idx" ON "shift_templates" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "shifts_creator_start_idx" ON "shifts" USING btree ("creator_id","starts_at");--> statement-breakpoint
CREATE INDEX "shifts_member_end_idx" ON "shifts" USING btree ("member_id","ends_at") WHERE "shifts"."cancelled_at" is null;--> statement-breakpoint
CREATE POLICY "team_read" ON "scheduling_settings" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "scheduling_settings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "scheduling_settings"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "scheduling_settings" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "scheduling_settings"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "shift_templates" AS PERMISSIVE FOR SELECT TO public USING ("shift_templates"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "shift_templates"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "team_insert" ON "shift_templates" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shift_templates"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shift_templates"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_update" ON "shift_templates" AS PERMISSIVE FOR UPDATE TO public USING ("shift_templates"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')) WITH CHECK ("shift_templates"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "member_read" ON "shifts" AS PERMISSIVE FOR SELECT TO public USING ("shifts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "shifts"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "team_insert" ON "shifts" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shifts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shifts"."created_by" = nullif(current_setting('app.user_id', true), '') and "shifts"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_update" ON "shifts" AS PERMISSIVE FOR UPDATE TO public USING ("shifts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')) WITH CHECK ("shifts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shifts"."updated_by" = nullif(current_setting('app.user_id', true), ''));
--> statement-breakpoint
-- Added by hand after `drizzle-kit generate` (ADR 0005, ADR 0023 § Données et RLS).
ALTER TABLE "scheduling_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A member is never on two shifts at once, an account never has two members at once: decided by the database, so two
-- planners writing at the same moment cannot both win (23P01). A cancelled shift is out of both. Ranges are `[)`: a
-- shift that ends at 06:00 and one that starts at 06:00 do not overlap.
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_member_overlap_excl"
  EXCLUDE USING gist ("member_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("cancelled_at" IS NULL);--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_account_overlap_excl"
  EXCLUDE USING gist ("platform_account_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("cancelled_at" IS NULL);--> statement-breakpoint
-- Nothing of the planning is deleted: a shift is cancelled (`cancelled_at`), a template ended (`valid_until`), once.
-- A template changes nothing but that end; a shift never changes its creator, its account, its template or who made
-- it, a shift under way keeps its start and its member and only ends earlier, and a shift that has ended no longer
-- changes at all: the chatter's access window (ADR 0025) is read on these columns. The column grants below hold the
-- application role; these triggers hold every role, the admin one of the job that makes the templates' shifts
-- included.
CREATE FUNCTION "refuse_planning_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'this change to % is refused: the planning keeps its past (EQ-02)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "shift_templates_kept" BEFORE UPDATE ON "shift_templates" FOR EACH ROW
  WHEN (
    OLD."valid_until" IS NOT NULL
    OR (OLD."id", OLD."creator_id", OLD."platform_account_id", OLD."member_id", OLD."weekday", OLD."start_minute",
        OLD."end_minute", OLD."valid_from", OLD."created_by", OLD."created_at")
       IS DISTINCT FROM
       (NEW."id", NEW."creator_id", NEW."platform_account_id", NEW."member_id", NEW."weekday", NEW."start_minute",
        NEW."end_minute", NEW."valid_from", NEW."created_by", NEW."created_at")
  )
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE TRIGGER "shift_templates_not_deleted" BEFORE DELETE ON "shift_templates" FOR EACH ROW
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE TRIGGER "shifts_kept" BEFORE UPDATE ON "shifts" FOR EACH ROW
  WHEN (
    OLD."ends_at" <= now()
    OR OLD."cancelled_at" IS NOT NULL
    OR (OLD."starts_at" <= now()
        AND (NEW."starts_at" IS DISTINCT FROM OLD."starts_at"
             OR NEW."member_id" IS DISTINCT FROM OLD."member_id"
             OR NEW."ends_at" > OLD."ends_at"))
    OR (OLD."id", OLD."creator_id", OLD."platform_account_id", OLD."template_id", OLD."template_starts_at",
        OLD."created_by", OLD."created_at")
       IS DISTINCT FROM
       (NEW."id", NEW."creator_id", NEW."platform_account_id", NEW."template_id", NEW."template_starts_at",
        NEW."created_by", NEW."created_at")
  )
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE TRIGGER "shifts_not_deleted" BEFORE DELETE ON "shifts" FOR EACH ROW
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave: a TRUNCATE would pass the RLS and the BEFORE DELETE
-- triggers.
REVOKE ALL ON "scheduling_settings", "shift_templates", "shifts" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "scheduling_settings" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_templates", "shifts" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("valid_until") ON "shift_templates" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("member_id", "starts_at", "ends_at", "cancelled_at", "stopped_at", "updated_by", "updated_at") ON "shifts" TO nirvana_app;
