-- ADR 0107 § 13 (CRB-01): the creator's kinds join the closed list of the game's gains, on the same table as the
-- chatter's (migration 0194). Nothing else changes: her gains are written by the job `rewards.evaluate` alone
-- (service role), she reads her own and marks their reveal (own_read, own_reveal), the owner and an active manager
-- read them (team_read, which a creator's account never passes), a chatter never does. Nothing is deleted.
ALTER TABLE "reward_gains" DROP CONSTRAINT "reward_gains_kind_check";--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_kind_check" CHECK ("reward_gains"."kind" in ('tier', 'first_sale', 'day_record', 'fortnight_record', 'fortnight_on_time', 'streak_5', 'streak_10', 'streak_25', 'ten_ppv_shift', 'day_streak_7', 'day_streak_14', 'day_streak_30', 'day_streak_50', 'day_streak_100', 'first_drop', 'first_on_time_delivery', 'delivery_streak_5', 'delivery_streak_10', 'delivery_streak_25', 'perfect_day', 'first_script', 'full_stock', 'hit_content'));
