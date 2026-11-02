-- Second factor for every dashboard account (ADR 0046, SEC-02). `two_factor` holds the authenticator secret and the
-- backup codes of an account, both encrypted with the Better Auth secret (never in clear), out of RLS like the rest of
-- the authentication tables, read and written by the application role (Better Auth runs on it). `user.two_factor_enabled`
-- is false until the first code is confirmed: such an account opens nothing but the activation. `session.reauthenticated_at`
-- is when the password and the code were last given on a session, read by the guard of sensitive actions (§ 3).
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "two_factor_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "reauthenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "two_factor" TO nirvana_app;
