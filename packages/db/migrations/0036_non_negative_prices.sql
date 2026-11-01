-- A price on a message or a media send is what a fan pays, never below zero: the connectors' contracts refuse one
-- already, the database now refuses it too (a negative price would lower the sales sums). Nothing is deployed and no
-- connector has written a negative price; a database that holds one refuses this migration, nothing is rewritten.
ALTER TABLE "messages" ADD CONSTRAINT "messages_price_minor_check" CHECK ("messages"."price_minor" is null or "messages"."price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "media_sends" ADD CONSTRAINT "media_sends_price_minor_check" CHECK ("media_sends"."price_minor" is null or "media_sends"."price_minor" >= 0);