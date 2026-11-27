import { z } from 'zod';

import { ConversationIdSchema, CreatorIdSchema, FanIdSchema } from './ids';

/**
 * « À qui parler maintenant » (accueil du chatteur, Charles 21/11): who to write to first, in the method's order,
 * payers who wait, then the new ones to welcome, then the big payers gone quiet. Each fan comes with what he spent, as
 * Reveal shows it to chatters, his tier and the day of his last purchase (Charles, 21/11).
 */

/**
 * What a fan is to the agency, read from what he unlocked (Charles, 21/11, tiers proposed after Reveal's lists):
 * `new` while he has bought nothing and arrived less than `FAN_NEW_DAYS` ago, `payer` from his first purchase, then
 * `good`, `very_good` and `whale` from the thresholds the owner sets for each creator (`FanTiersSetting`). A fan older
 * than that who never paid has no tier.
 */
export const FanTierSchema = z.enum(['new', 'payer', 'good', 'very_good', 'whale']);
export type FanTier = z.infer<typeof FanTierSchema>;

/** A fan stays « Nouveau » this many days after he first wrote, while he buys nothing. */
export const FAN_NEW_DAYS = 7;
/** A very good payer or a whale is « silencieux » after this many days without a message either way (Charles, 21/11). */
export const FAN_SILENT_DAYS = 5;
/** Each group shows at most this many fans: the list says who first, the inbox has the rest. */
export const TO_TALK_GROUP_MAX = 5;

/** What the chatter reads of a fan's money, in Impera and in the extension's panel (Charles, 21/11). */
export const FanStandingSchema = z.strictObject({
  tier: FanTierSchema.nullable(),
  /** What he unlocked with her, in euro cents, his dollars at the last known rate (none known, they do not count). */
  spentMinor: z.number().int().min(0),
  lastPurchaseAt: z.iso.datetime().nullable(),
});
export type FanStanding = z.infer<typeof FanStandingSchema>;

export const ToTalkFanSchema = z.strictObject({
  conversationId: ConversationIdSchema,
  fanId: FanIdSchema,
  fanDisplayName: z.string(),
  tier: FanTierSchema.nullable(),
  /** Since when his last message waits for an answer, in minutes; `null` when nothing waits. */
  waitingMinutes: z.number().int().min(0).nullable(),
  /** What he unlocked with her, in euro cents, his dollars at the last known rate (none known, they do not count). */
  spentMinor: z.number().int().min(0),
  lastPurchaseAt: z.iso.datetime().nullable(),
  /** When he first wrote to her. */
  fanSince: z.iso.datetime(),
  /** The latest message either way, `null` before any. */
  lastMessageAt: z.iso.datetime().nullable(),
});
export type ToTalkFan = z.infer<typeof ToTalkFanSchema>;

/** `GET /v1/conversations/to-talk?creatorId=` → 200. */
export const ToTalkSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  /** Payers whose last message waits, the highest tier first, then the longest wait. */
  waiting: z.array(ToTalkFanSchema),
  /** New fans never answered or waiting, the longest wait first. */
  newcomers: z.array(ToTalkFanSchema),
  /** Very good payers and whales quiet for `FAN_SILENT_DAYS`, sales neither frozen nor fragile: the most spent first. */
  silent: z.array(ToTalkFanSchema),
  /** Conversations nobody writes in until a human lifts a doubt on his age: said in red, never listed. */
  ageHeld: z.number().int().min(0),
});
export type ToTalk = z.infer<typeof ToTalkSchema>;

/**
 * `PUT /v1/creators/:id/fan-tiers` (owner): from how much, in euro cents, a fan is a good payer, a very good one, a
 * whale, rising. The defaults are the tiers proposed on 21/11 (50 €, 200 €, 500 €), each creator's to change.
 */
export const FanTiersSettingSchema = z
  .strictObject({
    goodFromMinor: z.number().int().positive().max(100_000_000).default(5_000),
    veryGoodFromMinor: z.number().int().positive().max(100_000_000).default(20_000),
    whaleFromMinor: z.number().int().positive().max(100_000_000).default(50_000),
  })
  .refine((t) => t.goodFromMinor < t.veryGoodFromMinor && t.veryGoodFromMinor < t.whaleFromMinor, {
    message: 'Les paliers montent',
  });
export type FanTiersSetting = z.infer<typeof FanTiersSettingSchema>;

/** His tier from what he spent, when he first wrote, and her thresholds. Pure: the server and the tests share it. */
export function fanTierOf(
  fan: { readonly spentMinor: number; readonly fanSince: Date },
  tiers: FanTiersSetting,
  now: Date,
): FanTier | null {
  if (fan.spentMinor >= tiers.whaleFromMinor) return 'whale';
  if (fan.spentMinor >= tiers.veryGoodFromMinor) return 'very_good';
  if (fan.spentMinor >= tiers.goodFromMinor) return 'good';
  if (fan.spentMinor > 0) return 'payer';
  return now.getTime() - fan.fanSince.getTime() < FAN_NEW_DAYS * 86_400_000 ? 'new' : null;
}

/** The words of a tier, as the chatter reads them in Impera and in the extension (Charles, 21/11). */
export const FAN_TIER_WORDS: Readonly<Record<FanTier, string>> = {
  new: 'Nouveau',
  payer: 'Payeur',
  good: 'Bon payeur',
  very_good: 'Très bon payeur',
  whale: 'Baleine',
};

/** The order a tier ranks in, the highest first. */
export const FAN_TIER_RANK: Readonly<Record<FanTier, number>> = {
  whale: 0,
  very_good: 1,
  good: 2,
  payer: 3,
  new: 4,
};
