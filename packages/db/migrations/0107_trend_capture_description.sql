-- VEI-01 lot c2 (ADR 0060 § 2, source 6). How a marked post is made, as the vision read the captures the extension
-- took while it showed: kept on its reading, a JSON object, only for a post marked for a creator. The captures
-- themselves are never written anywhere.
ALTER TABLE "trend_readings" ADD COLUMN "capture_description" jsonb;--> statement-breakpoint
ALTER TABLE "trend_readings" ADD CONSTRAINT "trend_readings_capture_marked_check" CHECK ("trend_readings"."capture_description" is null or ("trend_readings"."marked_for_creator_id" is not null and jsonb_typeof("trend_readings"."capture_description") = 'object'));
