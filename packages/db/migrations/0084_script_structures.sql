-- Script structures (SC-01, ADR 0056 § 1): the agency's library of scripts to shoot, their versions, and the queue of
-- structures to ask of each creator. Additive. The library is out of the creators' RLS, under the team's policies (the
-- owner and the active managers read, the owner writes); the queue is under her RLS and the same scopes.
CREATE TABLE "script_structure_queue" (
	"creator_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"structure_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_structure_queue_pkey" PRIMARY KEY("creator_id","position"),
	CONSTRAINT "script_structure_queue_structure_unique" UNIQUE("creator_id","structure_id"),
	CONSTRAINT "script_structure_queue_position_check" CHECK ("script_structure_queue"."position" between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "script_structure_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "script_structure_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"structure_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"moment" text NOT NULL,
	"segments" jsonb NOT NULL,
	"frozen_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_structure_versions_number_unique" UNIQUE("structure_id","version"),
	CONSTRAINT "script_structure_versions_version_check" CHECK ("script_structure_versions"."version" >= 1),
	CONSTRAINT "script_structure_versions_name_check" CHECK (char_length("script_structure_versions"."name") between 1 and 60),
	CONSTRAINT "script_structure_versions_segments_check" CHECK (jsonb_typeof("script_structure_versions"."segments") = 'array' and jsonb_array_length("script_structure_versions"."segments") >= 1),
	CONSTRAINT "script_structure_versions_moment_check" CHECK ("script_structure_versions"."moment" in ('day', 'night', 'both'))
);
--> statement-breakpoint
ALTER TABLE "script_structure_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "script_structures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reserved_creator_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "script_structures_archived_check" CHECK ("script_structures"."archived_at" is null or "script_structures"."archived_at" >= "script_structures"."created_at")
);
--> statement-breakpoint
ALTER TABLE "script_structures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "script_structure_queue" ADD CONSTRAINT "script_structure_queue_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_structure_queue" ADD CONSTRAINT "script_structure_queue_structure_id_script_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."script_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_structure_queue" ADD CONSTRAINT "script_structure_queue_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_structure_versions" ADD CONSTRAINT "script_structure_versions_structure_id_script_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."script_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_structure_versions" ADD CONSTRAINT "script_structure_versions_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_structures" ADD CONSTRAINT "script_structures_reserved_creator_id_creators_id_fk" FOREIGN KEY ("reserved_creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_structures" ADD CONSTRAINT "script_structures_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "script_structure_queue_structure_idx" ON "script_structure_queue" USING btree ("structure_id");--> statement-breakpoint
CREATE POLICY "team_read" ON "script_structure_queue" AS PERMISSIVE FOR SELECT TO public USING ("script_structure_queue"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "script_structure_queue" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("script_structure_queue"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "script_structure_queue"."added_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_delete" ON "script_structure_queue" AS PERMISSIVE FOR DELETE TO public USING ("script_structure_queue"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "script_structure_queue" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "team_read" ON "script_structure_versions" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "script_structure_versions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "script_structure_versions"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "script_structure_versions" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "script_structure_versions"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "script_structure_versions" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "team_read" ON "script_structures" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "script_structures" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "script_structures"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "script_structures" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "script_structures" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
ALTER TABLE "script_structures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "script_structure_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "script_structure_queue" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Rule 6 of ADR 0056 § 1: a version asked of a creator (`frozen_at`) never changes again, a version keeps its structure
-- and its number, and none is ever removed. For every role, the admin's included.
CREATE FUNCTION "refuse_script_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."frozen_at" IS NOT NULL
     OR NEW."structure_id" IS DISTINCT FROM OLD."structure_id" OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'this change to % is refused: a version asked of a creator is frozen (ADR 0056)', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "script_structure_versions_kept" BEFORE UPDATE OR DELETE ON "script_structure_versions" FOR EACH ROW
  EXECUTE FUNCTION "refuse_script_version_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the trigger).
REVOKE ALL ON "script_structures", "script_structure_versions", "script_structure_queue" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "script_structures", "script_structure_versions" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "script_structure_queue" TO nirvana_app;
