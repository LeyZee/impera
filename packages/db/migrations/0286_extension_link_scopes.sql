-- ADR 0109 and its amendment of 21/11: a link says what it allows beyond what every link did before (the watch's
-- readings, the copilot's verdict, the owner's « Sync »): writing a field of a fan's card (`fan_card`), writing a note on
-- him (`operator_note`). Fixed when the link is made (code, from the CRM's own rights); the links made before keep an
-- empty list and gain nothing in silence (§ 5): the person links the browser again.
ALTER TABLE "extension_links" ADD COLUMN "scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "extension_links" ADD CONSTRAINT "extension_links_scopes_check" CHECK ("extension_links"."scopes" <@ array['fan_card', 'operator_note']::text[]);--> statement-breakpoint
-- § 7: a member's departure and any change of his role revoke his links in the same transaction, whatever writes it
-- (the owner's « Départ », a role from today, the daily job that brings a dated role into force, the owner's transfer).
-- A link of a member who left already named nobody (read again at each call); now it is revoked too, and a link made
-- for a chatter's rights never serves a manager's, nor the reverse: the person links again and gets the scopes of now.
--
-- SECURITY DEFINER, run as the owner of the tables (the migration role, BYPASSRLS, ADR 0005): `extension_links` is out
-- of `nirvana_app`'s reach (migration 0100), and the application role changes members. It touches only the links of the
-- account of the row that changed, sets only `revoked_at`, and writes one `extension_link.revoke` line per link in the
-- audit log, by the account the transaction names (`app.user_id`) when there is one. No argument: nothing a caller
-- passes. `search_path` is pinned and every name qualified. No dynamic SQL.
CREATE FUNCTION public.extension_links_revoke_on_change()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  reason text;
  account text;
  revoked record;
BEGIN
  IF TG_TABLE_NAME = 'team_members' THEN
    account := NEW."user_id";
    IF NEW."status" = 'left' AND OLD."status" <> 'left' THEN
      reason := 'member_left';
    ELSIF NEW."team_role" IS DISTINCT FROM OLD."team_role" THEN
      reason := 'role_changed';
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    account := NEW."id";
    IF NEW."role" IS NOT DISTINCT FROM OLD."role" THEN
      RETURN NULL;
    END IF;
    reason := 'role_changed';
  END IF;
  FOR revoked IN
    UPDATE public."extension_links" l SET "revoked_at" = now()
      WHERE l."user_id" = account AND l."revoked_at" IS NULL
      RETURNING l."id"
  LOOP
    INSERT INTO public."audit_log" ("id", "user_id", "action", "entity", "entity_id", "details")
      VALUES (gen_random_uuid(), actor, 'extension_link.revoke', 'extension_link', revoked."id"::text,
        jsonb_build_object('reason', reason));
  END LOOP;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.extension_links_revoke_on_change() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "team_members_revoke_extension_links" AFTER UPDATE OF "status", "team_role" ON public."team_members"
  FOR EACH ROW EXECUTE FUNCTION public.extension_links_revoke_on_change();--> statement-breakpoint
CREATE TRIGGER "user_revoke_extension_links" AFTER UPDATE OF "role" ON public."user"
  FOR EACH ROW EXECUTE FUNCTION public.extension_links_revoke_on_change();
