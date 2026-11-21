-- ADR 0148 § 1 and § 3. A pause of the agent is her Arrêt with an end: `kill_switches.active_until`, read by every
-- reader as `active and (active_until is null or active_until > now())`; nothing to rewrite, the old rows have none.
-- Her dated exceptions get their own table, one row per creator and date, closed to her own account like her hours:
-- the agency writes them inside `withTenant`, the service role reads them (ADR 0087).
CREATE TABLE "agent_hour_exceptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"date" date NOT NULL,
	"ranges" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_hour_exceptions_creator_date_unique" UNIQUE("creator_id","date"),
	CONSTRAINT "agent_hour_exceptions_ranges_array_check" CHECK (jsonb_typeof("agent_hour_exceptions"."ranges") = 'array')
);
--> statement-breakpoint
ALTER TABLE "agent_hour_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kill_switches" ADD COLUMN "active_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_hour_exceptions" ADD CONSTRAINT "agent_hour_exceptions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_hour_exceptions" ADD CONSTRAINT "agent_hour_exceptions_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_hour_exceptions_creator_date_idx" ON "agent_hour_exceptions" USING btree ("creator_id","date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agent_hour_exceptions" AS PERMISSIVE FOR ALL TO public USING ("agent_hour_exceptions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("agent_hour_exceptions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "agent_hour_exceptions" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
ALTER TABLE "agent_hour_exceptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "agent_hour_exceptions" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_hour_exceptions" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "agent_hour_exceptions" TO impera_service;
--> statement-breakpoint
-- The planning's read of the agent's mode (0069) follows the same rule as every other reader of the kill switches
-- (ADR 0148 § 1, relecture Bilan de #865): a pause whose end has passed no longer stops her. Same definition as 0069
-- otherwise; CREATE OR REPLACE keeps the owner and the EXECUTE grant.
CREATE OR REPLACE FUNCTION public.calendar_agent()
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
  select k.active and (k.active_until is null or k.active_until > now()) into global_stop
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
               select k.active and (k.active_until is null or k.active_until > now())
               from public.kill_switches k
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
