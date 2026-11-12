-- Runs once when the volume is created (local development only).
-- Creates the application role without BYPASSRLS so that RLS applies to it (ADR 0005).
-- Tables are owned by nirvana_admin (the migration role); nirvana_app only gets grants.
-- The service role (ADR 0087) is created by the migrations, and `pnpm db:migrate` gives it its password.
-- The migrations create the tables, the RLS policies and FORCE ROW LEVEL SECURITY.
CREATE ROLE nirvana_app LOGIN PASSWORD 'change-me' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE impera TO nirvana_app;
GRANT USAGE ON SCHEMA public TO nirvana_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nirvana_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nirvana_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nirvana_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nirvana_app;
