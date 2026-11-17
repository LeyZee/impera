-- Recette of 16/11/2026, Médias. Two changes, nothing deleted.
--
-- PIL-19: a script is never an idea of the day (`IdeaDropCategorySchema`), yet the base took the category, and one such
-- row made the whole day of ideas unreadable. Only the list of categories changes. The new check is added NOT VALID,
-- then validated when every row already there fits: the code never wrote a script idea, so it always is. A row
-- written by hand that does not fit is left as it is, never deleted (the read skips it): the migration does not fail
-- for it, and the check still holds for every row written from now on.
--
-- « Tarif réduit » (Charles, 16/11): a reduced price for a time that Reveal sets on a script step is kept as read, so
-- that the step is never sent and its script never offered (Impera never sells at a discount). Two nullable columns:
-- every step already there has none. `platform_scripts.version_at`, the import that wrote a script's current version,
-- says since when a discount keeps it from being offered (« À traiter »); a script already there has no discount yet,
-- so its last import stands for it until the next one that rewrites it.
ALTER TABLE "content_ideas" DROP CONSTRAINT "content_ideas_category_check";--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_category_check" CHECK ("content_ideas"."category" in ('feed_shoot', 'feed_video', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post')) NOT VALID;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "content_ideas" VALIDATE CONSTRAINT "content_ideas_category_check";
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'content_ideas_category_check left NOT VALID: a script idea written by hand is still there';
END
$$;--> statement-breakpoint
ALTER TABLE "platform_script_steps" ADD COLUMN "discount_price_minor" integer;--> statement-breakpoint
ALTER TABLE "platform_script_steps" ADD COLUMN "discount_minutes" integer;--> statement-breakpoint
ALTER TABLE "platform_script_steps" ADD CONSTRAINT "platform_script_steps_discount_check" CHECK (coalesce("platform_script_steps"."discount_price_minor", 0) >= 0 and coalesce("platform_script_steps"."discount_minutes", 0) >= 0);--> statement-breakpoint
ALTER TABLE "platform_scripts" ADD COLUMN "version_at" timestamp with time zone;--> statement-breakpoint
UPDATE "platform_scripts" SET "version_at" = "synced_at";--> statement-breakpoint
ALTER TABLE "platform_scripts" ALTER COLUMN "version_at" SET NOT NULL;
