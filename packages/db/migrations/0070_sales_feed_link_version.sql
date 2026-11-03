-- The version of a chatter's link (CRM-03, ADR 0050 § 5): it changes, with the instant it changed, whenever the link
-- points elsewhere, never when the same link is posed again, so pay can freeze it in a statement's inputs and count
-- a link posed after a closing in the first period still open. Existing links get their first version, dated now.
ALTER TABLE "sales_feed_chatters" ADD COLUMN "link_version" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_feed_chatters" ADD COLUMN "link_version_at" timestamp with time zone DEFAULT now() NOT NULL;
