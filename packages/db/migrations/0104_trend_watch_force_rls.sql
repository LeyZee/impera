-- VEI-01 lot b: the trend watch's tables are forced under their policies, as every tenant table since 0077 (found by
-- the review of CR-05 a): the owner of a table no longer passes them by default. No policy, no row is touched.
ALTER TABLE "trend_signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trend_readings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_ideas" FORCE ROW LEVEL SECURITY;
