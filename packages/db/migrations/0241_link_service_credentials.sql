-- ADR 0120 § 3 (amendment of 20/11/2026), INS-02 lot c2. Additive. `link_service_credentials`: the agency's key of the
-- redirect service, sealed with CREDENTIALS_ENCRYPTION_KEYS, one row at most (the primary key can only be true).
-- Closed to the application role: row security forced without any policy, and every right revoked. Read and written
-- by the service role alone, through the owner's gesture (connect, replace, remove) and the reading of the links.
CREATE TABLE "link_service_credentials" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"key_ciphertext" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_service_credentials_singleton_check" CHECK ("link_service_credentials"."singleton")
);
--> statement-breakpoint
ALTER TABLE "link_service_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "link_service_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave.
REVOKE ALL ON "link_service_credentials" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "link_service_credentials" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "link_service_credentials" TO impera_service;
