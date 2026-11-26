-- ADR 0145 § 2 (« un média offert n'est jamais revendu »): when a vault sync first read a media as sent for free by the
-- platform. Set once, never cleared: a paid step of a script never sells it. Nullable, nothing backfilled: the next sync
-- of each account reads it.
ALTER TABLE "media_platform_refs" ADD COLUMN "sent_for_free_at" timestamp with time zone;
--> statement-breakpoint
-- « Retirer » a blocked drop failed (grande recette du 21/11): the check wanted its reason gone, and her guard (0108)
-- never lets her clear it. A withdrawn drop now keeps why it was blocked; no new right for anyone.
ALTER TABLE "content_drops" DROP CONSTRAINT "content_drops_blocked_check";--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_blocked_check" CHECK (("content_drops"."state" <> 'blocked' or "content_drops"."blocked_reason" is not null)
        and ("content_drops"."blocked_reason" is null or "content_drops"."state" in ('blocked', 'withdrawn'))
        and coalesce(char_length("content_drops"."blocked_reason"), 1) between 1 and 200);