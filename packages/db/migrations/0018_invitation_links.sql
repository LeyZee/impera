-- Invitation links (EQ-10): single-use links to choose a password, for a member's first access or a reset. Additive.
-- Holds only the SHA-256 of each token. Out of RLS and out of reach of the application role, like
-- provider_credentials: the server reaches it through withAdmin only.
CREATE TABLE "invitation_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitation_links_purpose_check" CHECK ("invitation_links"."purpose" in ('invitation', 'reset')),
	CONSTRAINT "invitation_links_expiry_check" CHECK ("invitation_links"."expires_at" > "invitation_links"."created_at"),
	CONSTRAINT "invitation_links_one_end_check" CHECK ("invitation_links"."used_at" is null or "invitation_links"."revoked_at" is null)
);
--> statement-breakpoint
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_links_live_unique" ON "invitation_links" USING btree ("member_id") WHERE "invitation_links"."used_at" is null and "invitation_links"."revoked_at" is null;--> statement-breakpoint
-- The default privileges of init.sql would hand DML to the application role; this table keeps it out.
REVOKE ALL ON "invitation_links" FROM nirvana_app;
