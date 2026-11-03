-- Calendar links (CR-12, ADR 0045 § 5, ADR 0042 § 4): a secret, read-only, revocable iCal address per dashboard
-- account. Additive. Holds only the SHA-256 of each token. Out of RLS and out of reach of the application role, like
-- invitation_links: the server reaches it through withAdmin only, and reads the feed with the holder's own rights.
CREATE TABLE "calendar_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "calendar_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "calendar_links_revoked_check" CHECK ("calendar_links"."revoked_at" is null or "calendar_links"."revoked_at" >= "calendar_links"."created_at")
);
--> statement-breakpoint
ALTER TABLE "calendar_links" ADD CONSTRAINT "calendar_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_links_live_unique" ON "calendar_links" USING btree ("user_id") WHERE "calendar_links"."revoked_at" is null;--> statement-breakpoint
-- The default privileges of init.sql would hand DML to the application role; this table keeps it out.
REVOKE ALL ON "calendar_links" FROM nirvana_app;
