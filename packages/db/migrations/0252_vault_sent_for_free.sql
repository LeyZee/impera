-- ADR 0145 § 2 (« un média offert n'est jamais revendu »): when a vault sync first read a media as sent for free by the
-- platform. Set once, never cleared: a paid step of a script never sells it. Nullable, nothing backfilled: the next sync
-- of each account reads it.
ALTER TABLE "media_platform_refs" ADD COLUMN "sent_for_free_at" timestamp with time zone;
