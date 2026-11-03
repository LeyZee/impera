-- CR-12, ADR 0045 § 1 and ADR 0048 § 3 (accepted by Charles, 02/11/2026): who chats when, for the whole team.
-- `shifts` keeps its `member_read` policy (a chatter reads his own shifts) and `team_members` its own: a view could not
-- open more without opening everything (with `security_invoker` it keeps `member_read`; without, it skips every RLS,
-- the isolation by creator included). These functions are the one door: SECURITY DEFINER, run as the owner of the
-- tables (the migration role, BYPASSRLS, ADR 0005), so each applies the boundary itself, from the account the
-- transaction names (`app.user_id`, set by `withMember`) and never from a value the caller passes.
-- `search_path` is pinned so that the caller cannot shadow a table or a function; each is STABLE and reads only.

-- Who the reader is to the calendar, decided from the database alone:
--   `all`     the owner, or a manager whose `team_members` row is `active` (the scope `agency`);
--   `team`    a chatter whose row is `active`: every shift of the team, in reading;
--   `own`     a member whose row is anything else (on leave, sick, travelling, suspended, left): his own shifts only;
--   `creator` a creator's account, inside one of her own creators (`app.creator_id`, set by her reading path, ADR
--             0042 § 2): the shifts of that creator only;
--   `none`    anyone else: an unknown account, an operator without a member row, a creator outside her creators.
-- Internal: the two readers below call it, nobody else, so that their boundaries never diverge (Bilan, 02/11).
CREATE FUNCTION public.calendar_reader_scope() RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  select case
    when u.id is null then 'none'
    when u.role = 'owner' then 'all'
    when u.role = 'creator' then
      case
        when nullif(current_setting('app.creator_id', true), '') is not null
          and nullif(current_setting('app.creator_id', true), '')::uuid = any (u.creator_ids)
        then 'creator'
        else 'none'
      end
    when m.id is null then 'none'
    when m.status <> 'active' then 'own'
    when m.team_role = 'manager' then 'all'
    else 'team'
  end
  from (select 1) as one
  left join public."user" u on u.id = nullif(current_setting('app.user_id', true), '')
  left join public.team_members m on m.user_id = u.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_reader_scope() FROM PUBLIC;
--> statement-breakpoint

-- The shifts of the calendar between `from_at` and `to_at` (those that overlap it), six columns and nothing else: the
-- member, his name in the team and his colour, the creator, the start and the end. Never a cancelled shift, never a
-- leave, a rate, a country, a status or a report. A window longer than 6 weeks, or empty, is refused: a month view
-- needs 6 weeks at most. The shift of a member who left keeps his name (`team_members` is never deleted).
CREATE FUNCTION public.calendar_shifts(from_at timestamptz, to_at timestamptz)
RETURNS TABLE (
  member_id uuid,
  member_name text,
  member_color text,
  creator_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  reader text := public.calendar_reader_scope();
BEGIN
  IF from_at IS NULL OR to_at IS NULL OR to_at <= from_at OR to_at - from_at > interval '42 days' THEN
    RAISE EXCEPTION 'calendar window must be at most 6 weeks' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    select s.member_id, m.display_name, m.color, s.creator_id, s.starts_at, s.ends_at
    from public.shifts s
    join public.team_members m on m.id = s.member_id
    where s.cancelled_at is null
      and s.starts_at < to_at
      and s.ends_at > from_at
      and case reader
        when 'all' then true
        when 'team' then true
        when 'own' then m.user_id = nullif(current_setting('app.user_id', true), '')
        when 'creator' then s.creator_id = nullif(current_setting('app.creator_id', true), '')::uuid
        else false
      end
    order by s.starts_at, s.creator_id, s.member_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_shifts(timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_shifts(timestamptz, timestamptz) TO nirvana_app;
--> statement-breakpoint

-- The agent in the calendar (ADR 0048): for each creator of the agency, her clock, the agent's mode in force and his
-- reply hours (`creators.agent_hours.reply`, `{"mode":"always"}` without a setting, P3-14). Nothing else: never the
-- follow-up quiet hours, the night, the persona, a prompt, the budget or a figure. The mode is the dashboard's
-- (supervision): `stop` when the latest global kill switch or hers is active, `auto` while one of her conversations
-- runs on its own (`mode = 'auto'`, not taken by a human nor paused), `copilot` otherwise. Only for `all` and `team`:
-- a creator never learns who wrote a message (ADR 0042 § 2, ADR 0021), a member restricted to his own shifts sees no
-- agent, and the calendar link never carries it.
CREATE FUNCTION public.calendar_agent()
RETURNS TABLE (
  creator_id uuid,
  time_zone text,
  mode text,
  reply jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  reader text := public.calendar_reader_scope();
  global_stop boolean;
BEGIN
  IF reader NOT IN ('all', 'team') THEN
    RETURN;
  END IF;
  select k.active into global_stop
  from public.kill_switches k
  where k.scope = 'global'
  order by k.set_at desc
  limit 1;
  RETURN QUERY
    select c.id,
           c.timezone,
           case
             when coalesce(global_stop, false) then 'stop'
             when coalesce((
               select k.active from public.kill_switches k
               where k.scope = 'creator' and k.scope_id = c.id
               order by k.set_at desc
               limit 1
             ), false) then 'stop'
             when exists (
               select 1 from public.conversations v
               where v.creator_id = c.id and v.mode = 'auto' and v.state not in ('human', 'paused')
             ) then 'auto'
             else 'copilot'
           end,
           coalesce(c.agent_hours -> 'reply', '{"mode":"always"}'::jsonb)
    from public.creators c
    order by c.id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.calendar_agent() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.calendar_agent() TO nirvana_app;
