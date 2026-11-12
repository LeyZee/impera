-- Recette créatrice du 11/11/2026, anomalie 2: the vision AI's failed tries on a dropped medium, counted on it. At the
-- describing job's attempts (`DESCRIPTION_TRIES`), neither the job nor the hourly backlog asks it again; the agency
-- does (« Réessayer » sets it back to 0), so that a medium the vision refuses no longer spends the AI budget each hour.
ALTER TABLE "media_assets" ADD COLUMN "description_failures" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_description_failures_check" CHECK ("media_assets"."description_failures" >= 0);