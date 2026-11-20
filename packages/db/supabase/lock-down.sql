-- Only Impera's roles reach Impera's schemas (ADR 0152 § 2, docs/runbooks/deploy.md).
--
-- Played by hand, as `postgres`, in Supabase's SQL editor: once after the first `migrate`, then again after every
-- Supabase upgrade. Running it twice changes nothing. The API and the worker refuse to start in production while one
-- of these roles can still reach our schemas (`assertNoForeignAccess`).
--
-- Revoking USAGE on a schema closes every object in it at once, including one a later migration would forget: a
-- role without USAGE on `public` reads no table, calls no function and uses no sequence of it, whatever the rights
-- on the objects themselves. PUBLIC loses USAGE too, since every role belongs to it. (USAGE of `graphile_worker` is
-- taken from PUBLIC by `migrate` itself, packages/db/src/migrate.ts.)
--
-- A closed list, like the check at startup: every role but ours, the superusers, the owner of the base and the
-- built-in `pg_*` roles loses what it was given, whatever the host names it. The host's readers of everything
-- (members of `pg_read_all_data`, such as `supabase_read_only_user`) still read: no grant of ours can close them.
-- That is an accepted risk, written in ADR 0152 and named in the log at every start.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nirvana_app, impera_service;
GRANT USAGE, CREATE ON SCHEMA public TO nirvana_admin;

DO $$
DECLARE
  other_role text;
  schema_name text;
BEGIN
  FOR other_role IN
    SELECT r.rolname FROM pg_roles r
     WHERE NOT r.rolsuper
       AND r.rolname NOT IN ('nirvana_app', 'impera_service', 'nirvana_admin')
       AND r.rolname NOT LIKE 'pg\_%'
       AND r.oid <> (SELECT d.datdba FROM pg_database d WHERE d.datname = current_database())
  LOOP
    BEGIN
      FOREACH schema_name IN ARRAY ARRAY['public', 'graphile_worker']
      LOOP
        CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name);
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', schema_name, other_role);
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', schema_name, other_role);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', schema_name, other_role);
        EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', schema_name, other_role);
      END LOOP;
      -- What `postgres` would create in `public` later: nothing should be, the check of owners at startup says so.
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', other_role);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', other_role);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', other_role);
      END IF;
    EXCEPTION WHEN undefined_object THEN
      NULL; -- A role dropped while the script ran has nothing left to lose.
    END;
  END LOOP;
END
$$;
