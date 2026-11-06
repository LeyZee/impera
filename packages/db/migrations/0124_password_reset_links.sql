-- « Mot de passe oublié » (SEC-05 lot 3, ADR 0068 § 3). Additive. `password_reset_links`: a link an account of the
-- agency asked for itself, sent to its private Telegram chat, 15 minutes, used once, the token's SHA-256 alone kept;
-- one live per account. Read and written by the admin role only: RLS forced without a policy, revoked from `nirvana_app`.
CREATE TABLE "password_reset_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_links_expiry_check" CHECK ("password_reset_links"."expires_at" > "password_reset_links"."created_at"),
	CONSTRAINT "password_reset_links_one_end_check" CHECK ("password_reset_links"."used_at" is null or "password_reset_links"."revoked_at" is null)
);
--> statement-breakpoint
ALTER TABLE "password_reset_links" ADD CONSTRAINT "password_reset_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_links_live_unique" ON "password_reset_links" USING btree ("user_id") WHERE "password_reset_links"."used_at" is null and "password_reset_links"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "password_reset_links_user_created_idx" ON "password_reset_links" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "password_reset_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_reset_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "password_reset_links" FROM nirvana_app;
