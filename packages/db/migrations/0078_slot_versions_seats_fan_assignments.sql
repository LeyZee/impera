CREATE TABLE "scheduling_slot_seats" (
	"version_id" uuid NOT NULL,
	"slot_rank" smallint NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"seats" smallint NOT NULL,
	CONSTRAINT "scheduling_slot_seats_pkey" PRIMARY KEY("version_id","slot_rank","platform_account_id"),
	CONSTRAINT "scheduling_slot_seats_rank_check" CHECK ("scheduling_slot_seats"."slot_rank" between 0 and 23),
	CONSTRAINT "scheduling_slot_seats_seats_check" CHECK ("scheduling_slot_seats"."seats" between 1 and 2)
);
--> statement-breakpoint
ALTER TABLE "scheduling_slot_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scheduling_slot_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"slots" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_slot_versions_effective_unique" UNIQUE("effective_at"),
	CONSTRAINT "scheduling_slot_versions_slots_check" CHECK (jsonb_typeof("scheduling_slot_versions"."slots") = 'array' and jsonb_array_length("scheduling_slot_versions"."slots") between 2 and 24)
);
--> statement-breakpoint
ALTER TABLE "scheduling_slot_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_fan_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"fan_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_fan_assignments_range_check" CHECK ("shift_fan_assignments"."ends_at" is null or "shift_fan_assignments"."ends_at" > "shift_fan_assignments"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "shift_fan_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scheduling_slot_seats" ADD CONSTRAINT "scheduling_slot_seats_version_id_scheduling_slot_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."scheduling_slot_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_slot_seats" ADD CONSTRAINT "scheduling_slot_seats_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_slot_versions" ADD CONSTRAINT "scheduling_slot_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_fan_assignments" ADD CONSTRAINT "shift_fan_assignments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_fan_assignments" ADD CONSTRAINT "shift_fan_assignments_fan_id_fans_id_fk" FOREIGN KEY ("fan_id") REFERENCES "public"."fans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_fan_assignments" ADD CONSTRAINT "shift_fan_assignments_shift_fk" FOREIGN KEY ("shift_id","creator_id","platform_account_id","member_id") REFERENCES "public"."shifts"("id","creator_id","platform_account_id","member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_fan_assignments_member_idx" ON "shift_fan_assignments" USING btree ("creator_id","member_id","starts_at");--> statement-breakpoint
CREATE POLICY "team_read" ON "scheduling_slot_seats" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "scheduling_slot_seats" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and exists (select 1 from scheduling_slot_versions v where v.id = "scheduling_slot_seats"."version_id" and v.effective_at > now()));--> statement-breakpoint
CREATE POLICY "owner_delete" ON "scheduling_slot_seats" AS PERMISSIVE FOR DELETE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' and exists (select 1 from scheduling_slot_versions v where v.id = "scheduling_slot_seats"."version_id" and v.effective_at > now()));--> statement-breakpoint
CREATE POLICY "team_read" ON "scheduling_slot_versions" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "scheduling_slot_versions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "scheduling_slot_versions"."created_by" = nullif(current_setting('app.user_id', true), '') and "scheduling_slot_versions"."effective_at" >= now());--> statement-breakpoint
CREATE POLICY "owner_delete" ON "scheduling_slot_versions" AS PERMISSIVE FOR DELETE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' and "scheduling_slot_versions"."effective_at" > now());--> statement-breakpoint
CREATE POLICY "member_read" ON "shift_fan_assignments" AS PERMISSIVE FOR SELECT TO public USING ("shift_fan_assignments"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "shift_fan_assignments"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- Added by hand after `drizzle-kit generate` (ADR 0005, ADR 0049).
-- The version in force today is the créneaux the grid reads now, copied from the settings when they exist: nothing
-- changes on screen. `-infinity`, so that it holds for every past shift; written before FORCE, by the migration role.
INSERT INTO "scheduling_slot_versions" ("id", "effective_at", "time_zone", "slots", "created_by")
SELECT gen_random_uuid(), '-infinity', s."time_zone",
  (SELECT jsonb_agg(
            jsonb_build_object(
              'startMinute', (s."slot_start_minute" + i * s."slot_length_minutes") % 1440,
              'endMinute', (s."slot_start_minute" + (i + 1) * s."slot_length_minutes") % 1440,
              'name', NULL)
            ORDER BY i)
     FROM generate_series(0, 1440 / s."slot_length_minutes" - 1) AS i),
  s."updated_by"
FROM "scheduling_settings" s;--> statement-breakpoint
ALTER TABLE "scheduling_slot_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scheduling_slot_seats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_fan_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A version that took effect is the past of the planning: it never changes, nor its seats, and neither is removed.
-- One still ahead is withdrawn whole (its seats go with it) and written again, never edited. For every role.
CREATE TRIGGER "scheduling_slot_versions_kept" BEFORE UPDATE ON "scheduling_slot_versions" FOR EACH ROW
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE TRIGGER "scheduling_slot_versions_not_deleted" BEFORE DELETE ON "scheduling_slot_versions" FOR EACH ROW
  WHEN (OLD."effective_at" <= now())
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE FUNCTION "refuse_effective_slot_seats"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."version_id" ELSE NEW."version_id" END;
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (
    SELECT 1 FROM "scheduling_slot_versions" v WHERE v."id" = version AND v."effective_at" <= now()
  ) THEN
    RAISE EXCEPTION 'this change to % is refused: the planning keeps its past (ADR 0049)', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "scheduling_slot_seats_kept" BEFORE INSERT OR UPDATE OR DELETE ON "scheduling_slot_seats" FOR EACH ROW
  EXECUTE FUNCTION "refuse_effective_slot_seats"();--> statement-breakpoint
-- An account takes up to three members at once (ADR 0049 § 2): the exclusion of 0021, one at a time, goes, and a
-- constraint trigger holds three for every write path, the admin role's included. Deferred to the commit, so that a
-- move of several shifts is judged on where they end. It takes the account's lock (the one the server takes first,
-- `scheduling.account:`) before counting: two transactions that each add one cannot both pass, since the second counts
-- after the first has committed. SECURITY DEFINER: the count reads every shift of the account, whatever the reader's
-- RLS sees. Until a reinforcement is placed on purpose (CR-13), the server itself still keeps one.
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_account_overlap_excl";--> statement-breakpoint
CREATE INDEX "shifts_account_range_idx" ON "shifts" USING gist ("platform_account_id", tstzrange("starts_at", "ends_at", '[)'))
  WHERE ("cancelled_at" IS NULL);--> statement-breakpoint
CREATE FUNCTION "shifts_account_cap"() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current record;
  most bigint;
BEGIN
  SELECT s."platform_account_id", s."starts_at", s."ends_at" INTO current
    FROM "public"."shifts" s WHERE s."id" = NEW."id" AND s."cancelled_at" IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scheduling.account:' || current."platform_account_id"::text, 0));
  -- The most shifts at once over its hours: the count only grows where one starts, so its start and theirs suffice.
  SELECT max((
    SELECT count(*) FROM "public"."shifts" o
     WHERE o."platform_account_id" = current."platform_account_id" AND o."cancelled_at" IS NULL
       AND tstzrange(o."starts_at", o."ends_at", '[)') @> p.at))
    INTO most
    FROM (
      SELECT current."starts_at" AS at
      UNION
      SELECT o."starts_at" FROM "public"."shifts" o
       WHERE o."platform_account_id" = current."platform_account_id" AND o."cancelled_at" IS NULL
         AND o."starts_at" > current."starts_at" AND o."starts_at" < current."ends_at"
    ) p;
  IF most > 3 THEN
    RAISE EXCEPTION 'an account takes three shifts at once at most (ADR 0049)'
      USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'shifts_account_cap';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "shifts_account_cap" AFTER INSERT OR UPDATE OF "platform_account_id", "starts_at", "ends_at", "cancelled_at"
  ON "shifts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION "shifts_account_cap"();--> statement-breakpoint
-- A fan has one member at a time (ADR 0049 § 3): an open row (`ends_at` null) runs to the end of time.
ALTER TABLE "shift_fan_assignments" ADD CONSTRAINT "shift_fan_assignments_fan_excl"
  EXCLUDE USING gist ("fan_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);--> statement-breakpoint
-- A row never changes but to close `ends_at`, once, and is never removed: who held a fan stays (pay, ADR 0032).
CREATE TRIGGER "shift_fan_assignments_kept" BEFORE UPDATE ON "shift_fan_assignments" FOR EACH ROW
  WHEN (
    OLD."ends_at" IS NOT NULL
    OR NEW."ends_at" IS NULL
    OR (OLD."id", OLD."creator_id", OLD."platform_account_id", OLD."fan_id", OLD."member_id", OLD."shift_id",
        OLD."starts_at", OLD."created_at")
       IS DISTINCT FROM
       (NEW."id", NEW."creator_id", NEW."platform_account_id", NEW."fan_id", NEW."member_id", NEW."shift_id",
        NEW."starts_at", NEW."created_at")
  )
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE TRIGGER "shift_fan_assignments_not_deleted" BEFORE DELETE ON "shift_fan_assignments" FOR EACH ROW
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the triggers).
-- Nobody writes the fans held yet: EQ-08 grants the insert and the closing with its policies.
REVOKE ALL ON "scheduling_slot_versions", "scheduling_slot_seats", "shift_fan_assignments" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "scheduling_slot_versions", "scheduling_slot_seats" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "shift_fan_assignments" TO nirvana_app;
