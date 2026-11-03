CREATE VIEW "public"."creator_on_duty" WITH (security_barrier = true) AS (select s.id as shift_id, s.creator_id, s.platform_account_id, m.display_name, s.starts_at, s.ends_at
        from shifts s
        join team_members m on m.id = s.member_id
        where s.cancelled_at is null
          and m.status = 'active'
          and current_setting('app.account_role', true) = 'creator'
          and s.creator_id = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
-- Added by hand after `drizzle-kit generate` (README, « Écrire une migration »): the app role reads the view and
-- writes nothing through it, whatever the default privileges give.
GRANT SELECT ON "creator_on_duty" TO nirvana_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "creator_on_duty" FROM nirvana_app;
