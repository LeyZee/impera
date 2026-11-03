-- VEI-01 lot b. The trend watch's tables are forced under their policies, as every tenant table since 0077 (found by
-- the review of CR-05 a): the owner of a table no longer passes them by default. An extension's link is now one per
-- browser, named by its label (Chrome and Edge of one person no longer revoke each other), at most three live per
-- account, a limit the code holds under the account's lock. No row is lost: a live link keeps working, labelled
-- « Navigateur ».
DROP INDEX "extension_links_live_unique";--> statement-breakpoint
ALTER TABLE "extension_links" ADD COLUMN "label" text DEFAULT 'Navigateur' NOT NULL;--> statement-breakpoint
CREATE INDEX "extension_links_live_idx" ON "extension_links" USING btree ("user_id") WHERE "extension_links"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "extension_links" ADD CONSTRAINT "extension_links_label_check" CHECK (char_length("extension_links"."label") between 1 and 40);--> statement-breakpoint
ALTER TABLE "trend_signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trend_readings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_ideas" FORCE ROW LEVEL SECURITY;
