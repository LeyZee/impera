-- « Je prends mon poste » (EQ-12, shift_check_in): the member dates the real start of his shift in one gesture, from
-- Aujourd'hui. The planning's hours stay what they are (pay, the access window and the routing of a sale read them);
-- `checked_in_at` only says when the member said he was there, for the « shift non pris » alert of the manager and the
-- owner (Alertes) and for the planning.
ALTER TABLE "shifts" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
-- No column grant: `nirvana_app` reads it through its table grant and never writes it. A member writes it through
-- `check_in_own_shift` and nothing else; the owner and a manager never date a check-in for a member.
--
-- A check-in belongs to the member and the hours it was made for. A shift that changes member (a swap, a move by the
-- owner) or start loses it, and a shift is always written without one (the table grant of INSERT covers the column):
-- the database clears it, whatever wrote the row, so no path can plan a shift already taken.
CREATE FUNCTION public.shifts_clear_check_in()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."member_id" IS DISTINCT FROM OLD."member_id"
    OR NEW."starts_at" IS DISTINCT FROM OLD."starts_at" THEN
    NEW."checked_in_at" := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "shifts_clear_check_in" BEFORE INSERT OR UPDATE OF "member_id", "starts_at" ON public."shifts"
  FOR EACH ROW EXECUTE FUNCTION public.shifts_clear_check_in();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.shifts_clear_check_in() FROM PUBLIC;--> statement-breakpoint
-- SECURITY DEFINER, run as the owner of the tables (the migration role, BYPASSRLS, ADR 0005), like the zone's (0217)
-- and the calendar's (0069): it applies the boundary itself, from the account the transaction names (`app.user_id`,
-- set by `withMember`), never from a value the caller passes. One argument, the shift: never a member nor an account.
-- It touches that one shift and only its `checked_in_at` (never `updated_at` nor `updated_by`: a check-in is not a
-- change of the planning), and never changes `app.team_scope`.
-- `search_path` is pinned and every name qualified. No dynamic SQL.
--
-- The shift is the reader's own (`team_members.user_id`, unique since 0015), not cancelled, and the reader is
-- `active`: anything else answers `not_found`, one answer whether the shift is someone else's or does not exist. It
-- is taken from the opening of its access window (`starts_at` − the planning's margin) until its end; a stopped shift
-- has ended. A second check-in answers the first instant, unchanged (`already`): the gesture is idempotent. The trace
-- keeps the shift, never an IP nor a device.
CREATE FUNCTION public.check_in_own_shift(shift uuid)
RETURNS TABLE (outcome text, taken_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  reader text := nullif(current_setting('app.user_id', true), '');
  own record;
  margin integer;
  instant timestamptz := now();
  touched bigint;
BEGIN
  IF reader IS NULL THEN
    RAISE EXCEPTION 'no reader for the check-in' USING ERRCODE = '42501';
  END IF;
  SELECT s."id", s."starts_at", s."ends_at", s."stopped_at", s."checked_in_at" AS taken INTO own
    FROM public."shifts" s
    JOIN public."team_members" m ON m."id" = s."member_id"
    WHERE s."id" = shift AND m."user_id" = reader AND m."status" = 'active' AND s."cancelled_at" IS NULL
    FOR UPDATE OF s;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF own.taken IS NOT NULL THEN
    RETURN QUERY SELECT 'already'::text, own.taken;
    RETURN;
  END IF;
  IF own."stopped_at" IS NOT NULL OR instant >= own."ends_at" THEN
    RETURN QUERY SELECT 'ended'::text, NULL::timestamptz;
    RETURN;
  END IF;
  margin := coalesce((SELECT g."access_margin_minutes" FROM public."scheduling_settings" g), 15);
  IF instant < own."starts_at" - make_interval(mins => margin) THEN
    RETURN QUERY SELECT 'early'::text, NULL::timestamptz;
    RETURN;
  END IF;
  UPDATE public."shifts" SET "checked_in_at" = instant WHERE "id" = own."id";
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 1 THEN
    RAISE EXCEPTION 'the check-in was not written' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."audit_log" ("id", "user_id", "action", "entity", "entity_id", "details", "ip")
    VALUES (pg_catalog.gen_random_uuid(), reader, 'shift.check_in', 'shift', own."id"::text,
      pg_catalog.jsonb_build_object('startsAt', own."starts_at"), NULL);
  RETURN QUERY SELECT 'checked_in'::text, instant;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.check_in_own_shift(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.check_in_own_shift(uuid) TO nirvana_app;
