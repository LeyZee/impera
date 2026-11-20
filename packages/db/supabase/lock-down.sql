-- Supabase's own roles get nothing of Impera (ADR 0152 § 2, docs/runbooks/deploy.md).
--
-- Played by hand, as `postgres`, in Supabase's SQL editor: once after the first `migrate`, then again after every
-- Supabase upgrade. Running it twice changes nothing. The API and the worker refuse to start in production while one
-- of these roles can still reach our schemas (`assertNoForeignAccess`).
--
-- Revoking USAGE on a schema closes every object in it at once, including one a later migration would forget: a
-- role without USAGE on `public` reads no table, calls no function and uses no sequence of it, whatever the rights
-- on the objects themselves. PUBLIC loses USAGE too, since every role belongs to it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nirvana_app, impera_service;
GRANT USAGE, CREATE ON SCHEMA public TO nirvana_admin;

DO $$
DECLARE
  predefined text;
  schema_name text;
BEGIN
  FOREACH predefined IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'authenticator', 'supabase_read_only_user']
  LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = predefined);
    FOREACH schema_name IN ARRAY ARRAY['public', 'graphile_worker']
    LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name);
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', schema_name, predefined);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', schema_name, predefined);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', schema_name, predefined);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', schema_name, predefined);
    END LOOP;
    -- What `postgres` would create in `public` later: nothing should be, the check of owners at startup says so.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres');
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', predefined);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', predefined);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', predefined);
  END LOOP;
END
$$;
