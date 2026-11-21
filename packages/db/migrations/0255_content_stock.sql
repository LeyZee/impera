ALTER TABLE "content_drops" DROP CONSTRAINT "content_drops_category_check";--> statement-breakpoint
ALTER TABLE "content_drops" DROP CONSTRAINT "content_drops_corrected_from_check";--> statement-breakpoint
ALTER TABLE "content_requests" DROP CONSTRAINT "content_requests_category_check";--> statement-breakpoint
ALTER TABLE "content_ideas" DROP CONSTRAINT "content_ideas_category_check";--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_category_check" CHECK ("content_drops"."category" in ('feed_shoot', 'feed_video', 'script', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post', 'whale_gift', 'voice_beep', 'voice_real', 'sale_video'));--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_corrected_from_check" CHECK ("content_drops"."corrected_from" in ('feed_shoot', 'feed_video', 'script', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post', 'whale_gift', 'voice_beep', 'voice_real', 'sale_video'));--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_category_check" CHECK ("content_requests"."category" in ('feed_shoot', 'feed_video', 'script', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post', 'whale_gift', 'voice_beep', 'voice_real', 'sale_video'));--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_category_check" CHECK ("content_ideas"."category" in ('feed_shoot', 'feed_video', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post', 'whale_gift', 'voice_beep', 'voice_real', 'sale_video'));--> statement-breakpoint
ALTER POLICY "creator_no_insert" ON "media_descriptions" TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' or ("media_descriptions"."author" = 'human' and "media_descriptions"."model" = 'human'
        and "media_descriptions"."validated_by" = nullif(current_setting('app.user_id', true), '') and "media_descriptions"."validated_at" is not null and exists (select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
       where f.media_asset_id = "media_descriptions"."media_asset_id" and d.creator_id = "media_descriptions"."creator_id"
         and d.state <> 'withdrawn' and f.state in ('kept', 'duplicate'))
        and not (cardinality("media_descriptions"."review_reasons") > 0 or jsonb_array_length(coalesce("media_descriptions"."content" -> 'flags', '[]'::jsonb)) > 0) and not exists (select 1 from media_descriptions w
       where w.media_asset_id = "media_descriptions"."media_asset_id" and w.validated_at is null
         and (cardinality(w.review_reasons) > 0
              or jsonb_array_length(coalesce(w.content -> 'flags', '[]'::jsonb)) > 0))));--> statement-breakpoint
ALTER POLICY "creator_no_update" ON "media_descriptions" TO public USING (current_setting('app.account_role', true) is distinct from 'creator' or ("media_descriptions"."validated_at" is null and exists (select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
       where f.media_asset_id = "media_descriptions"."media_asset_id" and d.creator_id = "media_descriptions"."creator_id"
         and d.state <> 'withdrawn' and f.state in ('kept', 'duplicate')) and not (cardinality("media_descriptions"."review_reasons") > 0 or jsonb_array_length(coalesce("media_descriptions"."content" -> 'flags', '[]'::jsonb)) > 0))) WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' or ("media_descriptions"."validated_by" = nullif(current_setting('app.user_id', true), '') and exists (select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
       where f.media_asset_id = "media_descriptions"."media_asset_id" and d.creator_id = "media_descriptions"."creator_id"
         and d.state <> 'withdrawn' and f.state in ('kept', 'duplicate'))));