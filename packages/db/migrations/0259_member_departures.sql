-- A member's departure (ADR 0166). Additive. `team_member_departures`: the owner sets the hour it ends, the job
-- `team.member_departure` applies it at that hour in the name of the owner who set it, or the owner cancels it before;
-- « Parti » in « Changer le statut » writes one applied at once. One waiting per member, never deleted. « Accès Reveal
-- retiré » is the owner's dated tick. The owner writes it, the member reads his own (policies, RLS forced); the service
-- role has no grant. An end or a tick once set never changes (trigger). Its reason is a note of the member's record.
CREATE TABLE "team_member_departures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"applied_at" timestamp with time zone,
	"reveal_removed_at" timestamp with time zone,
	"reveal_removed_by" text,
	CONSTRAINT "team_member_departures_window_check" CHECK ("team_member_departures"."ends_at" >= "team_member_departures"."created_at" - interval '1 minute' and "team_member_departures"."ends_at" <= "team_member_departures"."created_at" + interval '31 days'),
	CONSTRAINT "team_member_departures_one_end_check" CHECK ("team_member_departures"."cancelled_at" is null or "team_member_departures"."applied_at" is null),
	CONSTRAINT "team_member_departures_cancel_check" CHECK (("team_member_departures"."cancelled_at" is null) = ("team_member_departures"."cancelled_by" is null)),
	CONSTRAINT "team_member_departures_applied_check" CHECK ("team_member_departures"."applied_at" is null or "team_member_departures"."applied_at" >= "team_member_departures"."ends_at"),
	CONSTRAINT "team_member_departures_reveal_check" CHECK (("team_member_departures"."reveal_removed_at" is null) = ("team_member_departures"."reveal_removed_by" is null) and ("team_member_departures"."reveal_removed_at" is null or "team_member_departures"."cancelled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "team_member_departures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_member_departures" ADD CONSTRAINT "team_member_departures_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_departures" ADD CONSTRAINT "team_member_departures_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_departures" ADD CONSTRAINT "team_member_departures_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_departures" ADD CONSTRAINT "team_member_departures_reveal_removed_by_user_id_fk" FOREIGN KEY ("reveal_removed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_departures_waiting_unique" ON "team_member_departures" USING btree ("member_id") WHERE "team_member_departures"."cancelled_at" is null and "team_member_departures"."applied_at" is null;--> statement-breakpoint
CREATE INDEX "team_member_departures_member_idx" ON "team_member_departures" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE POLICY "owner_or_self_select" ON "team_member_departures" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' or exists (select 1 from team_members m where m.id = "team_member_departures"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "team_member_departures" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "team_member_departures"."created_by" = nullif(current_setting('app.user_id', true), '') and "team_member_departures"."cancelled_at" is null and "team_member_departures"."reveal_removed_at" is null and "team_member_departures"."created_at" = now() and ("team_member_departures"."applied_at" is null or ("team_member_departures"."applied_at" = now() and "team_member_departures"."ends_at" = now())));--> statement-breakpoint
CREATE POLICY "owner_update" ON "team_member_departures" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
ALTER TABLE "team_member_departures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave.
REVOKE ALL ON "team_member_departures" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "team_member_departures" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "team_member_departures" TO nirvana_app;--> statement-breakpoint
-- Its end and its tick only: the member, the hour and who set it never change once written.
GRANT UPDATE ("cancelled_at", "cancelled_by", "applied_at", "reveal_removed_at", "reveal_removed_by") ON "team_member_departures" TO nirvana_app;--> statement-breakpoint
CREATE FUNCTION "keep_team_member_departure"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at)
    OR (OLD.cancelled_by IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by)
    OR (OLD.applied_at IS NOT NULL AND NEW.applied_at IS DISTINCT FROM OLD.applied_at)
    OR (OLD.reveal_removed_at IS NOT NULL AND NEW.reveal_removed_at IS DISTINCT FROM OLD.reveal_removed_at)
    OR (OLD.reveal_removed_by IS NOT NULL AND NEW.reveal_removed_by IS DISTINCT FROM OLD.reveal_removed_by)
    OR NEW.member_id IS DISTINCT FROM OLD.member_id
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'team_member_departures: an end or a tick once set never changes' USING ERRCODE = 'check_violation';
  END IF;
  -- Who cancels or ticks is the account of the transaction, never another owner's name.
  IF (OLD.cancelled_by IS NULL AND NEW.cancelled_by IS NOT NULL
      AND NEW.cancelled_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), ''))
    OR (OLD.reveal_removed_by IS NULL AND NEW.reveal_removed_by IS NOT NULL
      AND NEW.reveal_removed_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')) THEN
    RAISE EXCEPTION 'team_member_departures: signed by another account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "team_member_departures_keep" BEFORE UPDATE ON "team_member_departures" FOR EACH ROW EXECUTE FUNCTION "keep_team_member_departure"();--> statement-breakpoint
CREATE TRIGGER "team_member_departures_no_delete" BEFORE DELETE ON "team_member_departures" FOR EACH ROW EXECUTE FUNCTION "refuse_change"();
