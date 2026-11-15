-- Recette créatrice du 11/11/2026, anomalie 1: a drop of the feed, a story or a relance is put out by hand by the team
-- (ADR 0044: published by hand until the connector does), as a sent script is copied into Reveal (SC-03 c). The
-- check no longer keeps `exported_at` to numbered scripts; a script still needs its number. Nothing is dropped but the
-- constraint it replaces, and every row it held holds the new one.
ALTER TABLE "content_drops" DROP CONSTRAINT "content_drops_exported_check";--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_exported_check" CHECK (("content_drops"."exported_at" is null) = ("content_drops"."exported_by" is null)
        and ("content_drops"."exported_at" is null or "content_drops"."category" <> 'script' or "content_drops"."script_number" is not null));
