ALTER TABLE "invitation_links" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation_links" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_links_live_user_unique" ON "invitation_links" USING btree ("user_id") WHERE "invitation_links"."used_at" is null and "invitation_links"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_target_check" CHECK (("invitation_links"."member_id" is null) <> ("invitation_links"."user_id" is null));