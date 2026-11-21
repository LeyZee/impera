-- The member's own zone follows the device the app opens on (Charles 16/11: chatters see the hour of their phone; recette
-- CHT-01). The zone of a record is display only: the hours of Mon planning, the words of a report reminder, the strong
-- hours of « Mes chiffres ». Pay, its fortnights and its thresholds read the agency's zone, a shift keeps its instants,
-- and a leave froze its own zone and instants when it was asked.
--
-- `team_members` is written by the owner alone (`owner_update`), and stays so: a member changes their own zone through
-- this function and nothing else. SECURITY DEFINER, run as the owner of the tables (the migration role, BYPASSRLS,
-- ADR 0005), like the calendar's (0069): it applies the boundary itself, from the account the transaction names
-- (`app.user_id`, set by `withMember`) and never from a value the caller passes, touches that one record and only its
-- `time_zone` (and `updated_at`), and never changes `app.team_scope`. An account has one record at most:
-- `team_members_user_id_unique` (0015) is what makes the read by `user_id` name a single row. `search_path` is pinned so that the caller cannot
-- shadow a table or a function; every name is qualified. One argument, the zone: never a member nor an account. No
-- dynamic SQL: the zone is compared and bound, never interpolated.
--
-- The zone is one of the IANA regions only (« Région/Ville »: never Etc/, posix/, Factory nor localtime), 64 characters
-- at most and known to this server. Nothing is written when it is the record's already, or when the member left. At most
-- 10 changes a day per member, counted under the lock of the member's row in the transaction that writes: `audit_log`
-- is append-only. The trace keeps the zone before and after, never an IP nor a device; the owner reads it on the
-- member's record.
CREATE FUNCTION public.follow_own_time_zone(zone text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  reader text := nullif(current_setting('app.user_id', true), '');
  own record;
  touched bigint;
BEGIN
  IF reader IS NULL THEN
    RAISE EXCEPTION 'no reader for the zone' USING ERRCODE = '42501';
  END IF;
  IF zone IS NULL OR length(zone) > 64
    OR zone !~ '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = zone) THEN
    RAISE EXCEPTION 'unknown zone' USING ERRCODE = '22023';
  END IF;
  SELECT m."id", m."status", m."time_zone" INTO own
    FROM public."team_members" m WHERE m."user_id" = reader FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no record of the reader' USING ERRCODE = 'P0002';
  END IF;
  IF own."status" = 'left' OR own."time_zone" = zone THEN
    RETURN own."time_zone";
  END IF;
  IF (SELECT count(*) FROM public."audit_log" a
       WHERE a."action" = 'team_member.time_zone_follow' AND a."entity" = 'team_member'
         AND a."entity_id" = own."id"::text AND a."created_at" > now() - interval '1 day') >= 10 THEN
    RETURN own."time_zone";
  END IF;
  UPDATE public."team_members" SET "time_zone" = zone, "updated_at" = now()
    WHERE "id" = own."id" AND "user_id" = reader;
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 1 THEN
    RAISE EXCEPTION 'the zone was not written' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."audit_log" ("id", "user_id", "action", "entity", "entity_id", "details", "ip")
    VALUES (pg_catalog.gen_random_uuid(), reader, 'team_member.time_zone_follow', 'team_member', own."id"::text,
      pg_catalog.jsonb_build_object('from', own."time_zone", 'to', zone), NULL);
  RETURN zone;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.follow_own_time_zone(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.follow_own_time_zone(text) TO nirvana_app;
