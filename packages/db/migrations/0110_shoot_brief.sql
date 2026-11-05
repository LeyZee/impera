-- VEI-01 lot d1 (ADR 0060 § 5, ADR 0042 § 4). Her shooting sheet (« fiche de tournage », `shoot_brief`): written by the
-- agency on a suggestion, copied once into the task she accepts. It stays out of her UPDATE grant on `creator_tasks`
-- (migration 0103 grants columns, and this one adds none). An idea keeps the suggestion it became (`suggestion_id`)
-- and, from lot d2, the content request born when she accepted it (`request_id`, origin `idea`); no foreign key: those
-- tables are not the trend watch's. Its title fits her agenda's (80, no idea is generated yet).
ALTER TABLE "content_requests" DROP CONSTRAINT "content_requests_origin_check";--> statement-breakpoint
ALTER TABLE "content_ideas" DROP CONSTRAINT "content_ideas_texts_check";--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD COLUMN "shoot_brief" text;--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD COLUMN "shoot_brief" text;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "suggestion_id" uuid;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_origin_check" CHECK ("content_requests"."origin" in ('agency', 'stock', 'cadence', 'idea'));--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD CONSTRAINT "creator_suggestions_shoot_brief_check" CHECK ("creator_suggestions"."shoot_brief" is null or char_length("creator_suggestions"."shoot_brief") between 1 and 600);--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD CONSTRAINT "creator_tasks_shoot_brief_check" CHECK ("creator_tasks"."shoot_brief" is null or char_length("creator_tasks"."shoot_brief") between 1 and 600);--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_suggestion_check" CHECK (("content_ideas"."suggestion_id" is not null) = ("content_ideas"."state" in ('suggested', 'declined', 'deposited')));--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_request_check" CHECK ("content_ideas"."request_id" is null or "content_ideas"."suggestion_id" is not null);--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_texts_check" CHECK (char_length("content_ideas"."title") between 1 and 80 and char_length("content_ideas"."to_shoot") between 1 and 600 and char_length("content_ideas"."reason") between 1 and 200);