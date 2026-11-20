-- AUT-01 (ADR 0110): which automation of the platform wrote a message (opener chosen by the fan, welcome, reminder
-- before expiry) or a fan's reply to a story. NULL: none. Messages read before keep NULL. Additive, no data touched.
ALTER TABLE "messages" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_origin_check" CHECK ("messages"."origin" in ('hook', 'welcome', 'expiration_reminder', 'story_reply'));