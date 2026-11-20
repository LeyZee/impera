-- Our functions run for our roles only (ADR 0152 § 2). PostgreSQL gives EXECUTE on every new function to PUBLIC,
-- that is to every role of the server, the predefined roles of a managed host included (Supabase's `anon`,
-- `authenticated`, `service_role`…). PUBLIC loses EXECUTE, now and for every function the owner creates later.
-- A function PUBLIC could call keeps exactly the callers Impera had: `nirvana_app` and `impera_service`. A function
-- already closed to PUBLIC keeps its own grants, untouched. A function to come gets no default grant: its migration
-- grants it to whom it serves, as before. Functions an extension owns are not ours and keep their rights.
-- The default is changed for the role that runs the migrations, in this base, without `IN SCHEMA`: rights by schema
-- only add to the global ones, so `IN SCHEMA public` could not take back EXECUTE, which PUBLIC has globally.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
       AND NOT EXISTS (SELECT 1 FROM pg_depend d
                        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO nirvana_app, impera_service', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
  END LOOP;
END
$$;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
