-- The version of a chatter's link (CRM-03, ADR 0050 § 5): it changes whenever the link points elsewhere, never when
-- the same link is posed again, so pay can freeze it in a statement's inputs. Existing links get their first version.
ALTER TABLE "sales_feed_chatters" ADD COLUMN "link_version" uuid DEFAULT gen_random_uuid() NOT NULL;
