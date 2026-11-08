-- VEI-08 (ADR 0082 § 3). The reel sheet (« fiche reel », `reel_brief`): beside the shooting sheet of a shoot for an
-- Instagram Reel, written by the agency on an idea or on a suggestion, copied once into the task she accepts. A JSON
-- object parsed by `ReelBriefSchema` on write and on read (docs/architecture/jsonb.md); an idea keeps one only as a
-- Reel Insta. It stays out of her UPDATE grant on `creator_tasks` (migration 0103 grants columns, this one adds none).
ALTER TABLE "creator_suggestions" ADD COLUMN "reel_brief" jsonb;--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD COLUMN "reel_brief" jsonb;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "reel_brief" jsonb;--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD CONSTRAINT "creator_suggestions_reel_brief_check" CHECK ("creator_suggestions"."reel_brief" is null or jsonb_typeof("creator_suggestions"."reel_brief") = 'object');--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD CONSTRAINT "creator_tasks_reel_brief_check" CHECK ("creator_tasks"."reel_brief" is null or jsonb_typeof("creator_tasks"."reel_brief") = 'object');--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_reel_brief_check" CHECK ("content_ideas"."reel_brief" is null or (jsonb_typeof("content_ideas"."reel_brief") = 'object' and "content_ideas"."category" = 'instagram_reel'));
