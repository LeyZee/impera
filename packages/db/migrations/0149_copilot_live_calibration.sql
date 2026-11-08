-- ADR 0086 § 4 and § 5: a real draft judged through the copilot panel of the extension becomes a `live` rating, one per
-- draft, naming the draft and keeping neither the fan's words nor a moment (his words stay in the conversation, under
-- their own retention); a playground rating keeps its session, its fan's message and its moment's purge as before.
-- The draft says who put it in the platform's field and when: it stays pending until what left is reconciled with it.
ALTER TABLE "calibration_ratings" DROP CONSTRAINT "calibration_ratings_moment_purge_check";--> statement-breakpoint
ALTER TABLE "calibration_ratings" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ALTER COLUMN "fan_message" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD COLUMN "source" text DEFAULT 'playground' NOT NULL;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD COLUMN "draft_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "placed_by" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "placed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD CONSTRAINT "calibration_ratings_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_placed_by_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_ratings_draft_unique" ON "calibration_ratings" USING btree ("draft_id") WHERE "calibration_ratings"."draft_id" is not null;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD CONSTRAINT "calibration_ratings_source_check" CHECK ("calibration_ratings"."source" in ('playground', 'live'));--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD CONSTRAINT "calibration_ratings_source_shape_check" CHECK (("calibration_ratings"."source" = 'playground' and "calibration_ratings"."session_id" is not null and "calibration_ratings"."draft_id" is null and "calibration_ratings"."fan_message" is not null and ("calibration_ratings"."moment" is null) = ("calibration_ratings"."moment_purged_at" is not null))
        or ("calibration_ratings"."source" = 'live' and "calibration_ratings"."draft_id" is not null and "calibration_ratings"."session_id" is null and "calibration_ratings"."fan_message" is null and "calibration_ratings"."moment" is null and "calibration_ratings"."moment_purged_at" is null));--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_placed_check" CHECK (("drafts"."placed_by" is null) = ("drafts"."placed_at" is null));