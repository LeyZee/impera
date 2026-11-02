-- Passkeys (ADR 0053, CR-01 lot c): the public part of each key, its credential id and signature counter, written by
-- Better Auth's `passkey` plugin on the application role like the other authentication tables (out of RLS). Nothing
-- biometric exists here. `name` is the device the key was added from, read by the server from the browser;
-- `last_used_at` is written by the server at each gesture, so the owner hears of a sign-in with a key never used before.
-- Removed with the account (cascade), at a reset of the second factor, a reset link and a departure.
-- `session.code_confirmed_at`: when the password and the code themselves were last given, never stamped by a passkey
-- gesture, so a key never adds another key (ADR 0053 § 2). Additive.
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkey_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "passkey" TO nirvana_app;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "code_confirmed_at" timestamp with time zone;
