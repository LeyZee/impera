-- First, the key the swaps' composite foreign keys point to (moved up by hand: Drizzle writes it after them).
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_id_creator_unique" UNIQUE("id","creator_id");--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"first_day" date NOT NULL,
	"last_day" date NOT NULL,
	"time_zone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decision_note" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" in ('pending', 'approved', 'refused', 'withdrawn', 'cancelled')),
	CONSTRAINT "leave_requests_days_check" CHECK ("leave_requests"."last_day" >= "leave_requests"."first_day" and "leave_requests"."last_day" - "leave_requests"."first_day" < 31),
	CONSTRAINT "leave_requests_range_check" CHECK ("leave_requests"."ends_at" > "leave_requests"."starts_at"),
	CONSTRAINT "leave_requests_texts_check" CHECK (coalesce(char_length("leave_requests"."note"), 0) <= 500 and coalesce(char_length("leave_requests"."decision_note"), 0) <= 500),
	CONSTRAINT "leave_requests_state_check" CHECK (("leave_requests"."decided_at" is null) = ("leave_requests"."decided_by" is null) and ("leave_requests"."cancelled_at" is null) = ("leave_requests"."cancelled_by" is null) and case "leave_requests"."status" when 'pending' then "leave_requests"."decided_at" is null and "leave_requests"."cancelled_at" is null when 'approved' then "leave_requests"."decided_at" is not null and "leave_requests"."cancelled_at" is null when 'refused' then "leave_requests"."decided_at" is not null and "leave_requests"."cancelled_at" is null when 'withdrawn' then "leave_requests"."decided_at" is null and "leave_requests"."cancelled_at" is not null else "leave_requests"."decided_at" is not null and "leave_requests"."cancelled_at" is not null end)
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_swap_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"shift_starts_at" timestamp with time zone NOT NULL,
	"shift_ends_at" timestamp with time zone NOT NULL,
	"target_member_id" uuid NOT NULL,
	"target_creator_id" uuid,
	"target_shift_id" uuid,
	"target_shift_starts_at" timestamp with time zone,
	"target_shift_ends_at" timestamp with time zone,
	"message" text,
	"status" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"reverted_at" timestamp with time zone,
	"reverted_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_swap_requests_status_check" CHECK ("shift_swap_requests"."status" in ('proposed', 'accepted', 'declined', 'withdrawn', 'lapsed', 'reverted')),
	CONSTRAINT "shift_swap_requests_members_check" CHECK ("shift_swap_requests"."requester_id" <> "shift_swap_requests"."target_member_id"),
	CONSTRAINT "shift_swap_requests_target_check" CHECK (num_nulls("shift_swap_requests"."target_shift_id", "shift_swap_requests"."target_creator_id", "shift_swap_requests"."target_shift_starts_at", "shift_swap_requests"."target_shift_ends_at") in (0, 4) and "shift_swap_requests"."target_shift_id" is distinct from "shift_swap_requests"."shift_id"),
	CONSTRAINT "shift_swap_requests_message_check" CHECK (coalesce(char_length("shift_swap_requests"."message"), 0) <= 500),
	CONSTRAINT "shift_swap_requests_state_check" CHECK (("shift_swap_requests"."resolved_by" is null or "shift_swap_requests"."resolved_at" is not null) and ("shift_swap_requests"."resolved_by" is not null or "shift_swap_requests"."status" in ('proposed', 'lapsed')) and ("shift_swap_requests"."reverted_at" is null) = ("shift_swap_requests"."reverted_by" is null) and ("shift_swap_requests"."status" = 'proposed') = ("shift_swap_requests"."resolved_at" is null) and ("shift_swap_requests"."status" = 'reverted') = ("shift_swap_requests"."reverted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_id_team_members_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_member_id_team_members_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_creator_id_creators_id_fk" FOREIGN KEY ("target_creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_reverted_by_user_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_shift_fk" FOREIGN KEY ("shift_id","creator_id") REFERENCES "public"."shifts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_shift_fk" FOREIGN KEY ("target_shift_id","target_creator_id") REFERENCES "public"."shifts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_requests_member_start_idx" ON "leave_requests" USING btree ("member_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_swap_requests_open_unique" ON "shift_swap_requests" USING btree ("shift_id","target_member_id",coalesce("target_shift_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "shift_swap_requests"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "shift_swap_requests_shift_idx" ON "shift_swap_requests" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shift_swap_requests_target_shift_idx" ON "shift_swap_requests" USING btree ("target_shift_id");--> statement-breakpoint
CREATE POLICY "swap_read" ON "shifts" AS PERMISSIVE FOR SELECT TO public USING ("shifts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from shift_swap_requests s where (s.shift_id = "shifts"."id" or s.target_shift_id = "shifts"."id") and s.status in ('proposed', 'accepted') and (exists (select 1 from team_members m where m.id = s.requester_id and m.user_id = nullif(current_setting('app.user_id', true), '')) or exists (select 1 from team_members m where m.id = s.target_member_id and m.user_id = nullif(current_setting('app.user_id', true), '')))));--> statement-breakpoint
CREATE POLICY "swap_update" ON "shifts" AS PERMISSIVE FOR UPDATE TO public USING ("shifts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from shift_swap_requests s where s.status = 'accepted' and s.resolved_at = now() and exists (select 1 from team_members m where m.id = s.target_member_id and m.user_id = nullif(current_setting('app.user_id', true), '')) and (s.shift_id = "shifts"."id" or s.target_shift_id = "shifts"."id"))) WITH CHECK ("shifts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "shifts"."updated_by" = nullif(current_setting('app.user_id', true), '') and "shifts"."cancelled_at" is null and "shifts"."stopped_at" is null and exists (select 1 from shift_swap_requests s where s.status = 'accepted' and s.resolved_at = now() and exists (select 1 from team_members m where m.id = s.target_member_id and m.user_id = nullif(current_setting('app.user_id', true), '')) and ((s.shift_id = "shifts"."id" and "shifts"."member_id" = s.target_member_id and "shifts"."starts_at" = s.shift_starts_at and "shifts"."ends_at" = s.shift_ends_at) or (s.target_shift_id = "shifts"."id" and "shifts"."member_id" = s.requester_id and "shifts"."starts_at" = s.target_shift_starts_at and "shifts"."ends_at" = s.target_shift_ends_at))));--> statement-breakpoint
CREATE POLICY "member_read" ON "leave_requests" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "leave_requests"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_insert" ON "leave_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (select 1 from team_members m where m.id = "leave_requests"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "leave_requests"."created_by" = nullif(current_setting('app.user_id', true), '') and "leave_requests"."status" = 'pending');--> statement-breakpoint
CREATE POLICY "member_withdraw" ON "leave_requests" AS PERMISSIVE FOR UPDATE TO public USING (exists (select 1 from team_members m where m.id = "leave_requests"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "leave_requests"."status" = 'pending') WITH CHECK (exists (select 1 from team_members m where m.id = "leave_requests"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "leave_requests"."status" = 'withdrawn' and "leave_requests"."cancelled_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_decide" ON "leave_requests" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')) WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and ("leave_requests"."status" = 'cancelled' or nullif(current_setting('app.team_scope', true), '') = 'owner' or not exists (select 1 from team_members m where m.id = "leave_requests"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))) and (("leave_requests"."status" in ('approved', 'refused') and "leave_requests"."decided_by" = nullif(current_setting('app.user_id', true), '')) or ("leave_requests"."status" = 'cancelled' and "leave_requests"."cancelled_by" = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "swap_read" ON "shift_swap_requests" AS PERMISSIVE FOR SELECT TO public USING (("shift_swap_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid or "shift_swap_requests"."target_creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "shift_swap_requests"."requester_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) or exists (select 1 from team_members m where m.id = "shift_swap_requests"."target_member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "requester_insert" ON "shift_swap_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shift_swap_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from team_members m where m.id = "shift_swap_requests"."requester_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "shift_swap_requests"."created_by" = nullif(current_setting('app.user_id', true), '') and "shift_swap_requests"."status" = 'proposed');--> statement-breakpoint
CREATE POLICY "requester_withdraw" ON "shift_swap_requests" AS PERMISSIVE FOR UPDATE TO public USING (("shift_swap_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid or "shift_swap_requests"."target_creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) and exists (select 1 from team_members m where m.id = "shift_swap_requests"."requester_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "shift_swap_requests"."status" = 'proposed') WITH CHECK (exists (select 1 from team_members m where m.id = "shift_swap_requests"."requester_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "shift_swap_requests"."status" in ('withdrawn', 'lapsed') and "shift_swap_requests"."resolved_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "target_answer" ON "shift_swap_requests" AS PERMISSIVE FOR UPDATE TO public USING (("shift_swap_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid or "shift_swap_requests"."target_creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) and exists (select 1 from team_members m where m.id = "shift_swap_requests"."target_member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "shift_swap_requests"."status" = 'proposed') WITH CHECK (exists (select 1 from team_members m where m.id = "shift_swap_requests"."target_member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "shift_swap_requests"."status" in ('accepted', 'declined', 'lapsed') and "shift_swap_requests"."resolved_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_update" ON "shift_swap_requests" AS PERMISSIVE FOR UPDATE TO public USING (("shift_swap_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid or "shift_swap_requests"."target_creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')) WITH CHECK (("shift_swap_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid or "shift_swap_requests"."target_creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and (("shift_swap_requests"."status" in ('withdrawn', 'lapsed') and "shift_swap_requests"."resolved_by" = nullif(current_setting('app.user_id', true), '')) or ("shift_swap_requests"."status" = 'reverted' and "shift_swap_requests"."reverted_by" = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- Written by hand (ADR 0031). Drizzle does not write what follows.
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Two pending or approved leaves of a member never overlap: decided by the database, as for the shifts.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_member_overlap_excl"
  EXCLUDE USING gist ("member_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" IN ('pending', 'approved'));--> statement-breakpoint
-- A leave keeps what was asked, and moves only forward: pending to approved, refused or withdrawn, approved to
-- cancelled before its end, keeping the instant and the author of its approval. Nothing is deleted. Held for every
-- role, as the planning's triggers of 0021.
CREATE TRIGGER "leave_requests_kept" BEFORE UPDATE ON "leave_requests" FOR EACH ROW
  WHEN (
    (OLD."id", OLD."member_id", OLD."first_day", OLD."last_day", OLD."time_zone", OLD."starts_at", OLD."ends_at",
     OLD."note", OLD."created_by", OLD."created_at")
    IS DISTINCT FROM
    (NEW."id", NEW."member_id", NEW."first_day", NEW."last_day", NEW."time_zone", NEW."starts_at", NEW."ends_at",
     NEW."note", NEW."created_by", NEW."created_at")
    OR NOT (
      (OLD."status" = 'pending' AND NEW."status" IN ('approved', 'refused', 'withdrawn'))
      OR (OLD."status" = 'approved' AND NEW."status" = 'cancelled' AND OLD."ends_at" > now()
          AND (NEW."decided_at", NEW."decided_by") IS NOT DISTINCT FROM (OLD."decided_at", OLD."decided_by"))
    )
  )
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE TRIGGER "leave_requests_not_deleted" BEFORE DELETE ON "leave_requests" FOR EACH ROW
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
-- A swap keeps who, which shifts and which hours it named, and moves only forward: proposed to accepted, declined,
-- withdrawn or lapsed, accepted to reverted, keeping the instant and the author of its acceptance. Nothing is deleted.
CREATE TRIGGER "shift_swap_requests_kept" BEFORE UPDATE ON "shift_swap_requests" FOR EACH ROW
  WHEN (
    (OLD."id", OLD."creator_id", OLD."shift_id", OLD."requester_id", OLD."shift_starts_at", OLD."shift_ends_at",
     OLD."target_member_id", OLD."target_creator_id", OLD."target_shift_id", OLD."target_shift_starts_at",
     OLD."target_shift_ends_at", OLD."message", OLD."created_by", OLD."created_at")
    IS DISTINCT FROM
    (NEW."id", NEW."creator_id", NEW."shift_id", NEW."requester_id", NEW."shift_starts_at", NEW."shift_ends_at",
     NEW."target_member_id", NEW."target_creator_id", NEW."target_shift_id", NEW."target_shift_starts_at",
     NEW."target_shift_ends_at", NEW."message", NEW."created_by", NEW."created_at")
    OR NOT (
      (OLD."status" = 'proposed' AND NEW."status" IN ('accepted', 'declined', 'withdrawn', 'lapsed'))
      OR (OLD."status" = 'accepted' AND NEW."status" = 'reverted'
          AND (NEW."resolved_at", NEW."resolved_by") IS NOT DISTINCT FROM (OLD."resolved_at", OLD."resolved_by"))
    )
  )
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
CREATE TRIGGER "shift_swap_requests_not_deleted" BEFORE DELETE ON "shift_swap_requests" FOR EACH ROW
  EXECUTE FUNCTION "refuse_planning_change"();--> statement-breakpoint
-- An exchange of two shifts at the same hours puts each member on the other's hours for an instant: the member
-- exclusion of 0021 becomes deferrable, still checked at each statement unless a swap defers it to the end of its
-- moves (`SET CONSTRAINTS … DEFERRED`, then `IMMEDIATE`). A deferrable constraint is no arbiter of `ON CONFLICT`:
-- the templates' job skips an occupied occurrence in a savepoint instead.
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_member_overlap_excl";--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_member_overlap_excl"
  EXCLUDE USING gist ("member_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("cancelled_at" IS NULL)
  DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the triggers).
REVOKE ALL ON "leave_requests", "shift_swap_requests" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "leave_requests", "shift_swap_requests" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("status", "decided_at", "decided_by", "decision_note", "cancelled_at", "cancelled_by", "updated_at")
  ON "leave_requests" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("status", "resolved_at", "resolved_by", "reverted_at", "reverted_by", "updated_at")
  ON "shift_swap_requests" TO nirvana_app;
