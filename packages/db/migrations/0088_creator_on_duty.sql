CREATE VIEW "public"."creator_on_duty" WITH (security_barrier = true) AS (select s.id as shift_id, s.creator_id, s.platform_account_id, m.display_name, s.starts_at, s.ends_at
        from shifts s
        join team_members m on m.id = s.member_id
        where s.cancelled_at is null
          and m.status = 'active'
          and current_setting('app.account_role', true) = 'creator'
          and s.creator_id = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
-- Added by hand after `drizzle-kit generate` (README, « Écrire une migration »). The view belongs to nirvana_admin, whose
-- BYPASSRLS lets it read `shifts` and `team_members` despite their forced RLS: its own filter (her creator and
-- app.account_role = 'creator') is what holds. The application role reads it and writes nothing through it.
REVOKE ALL ON "creator_on_duty" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_on_duty" TO nirvana_app;
