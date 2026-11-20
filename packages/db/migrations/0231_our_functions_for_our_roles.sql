-- Our functions run for our roles only (ADR 0152 § 2). PostgreSQL gives EXECUTE on every new function to PUBLIC,
-- that is to every role of the server, the predefined roles of a managed host included (Supabase's `anon`,
-- `authenticated`, `service_role`…). Impera's code calls its functions as `nirvana_app` or `impera_service` only:
-- they keep EXECUTE, PUBLIC loses it, now and for every function the owner creates later. Functions an extension
-- owns are not the owner's to change and keep their rights.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO nirvana_app, impera_service;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO nirvana_app, impera_service;
