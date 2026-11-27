import { z } from 'zod';

import { LlmRoleSchema } from './enums';
import { FanTiersSettingSchema } from './to-talk';

/**
 * Per-creator settings, stored in `creators.settings` (data-model.md). Follow-ups are not here: they live in the
 * persona (`persona.follow_ups`, P0-08). Every field has a default, so `{}` parses to a complete object.
 */

/** Brief intents the auto mode may approve on its own (phase 5); empty means everything stays copilot. */
export const AutoApproveCategorySchema = z.enum(['small_talk', 'kyc_answer', 'media_reaction', 'flirt']);
export type AutoApproveCategory = z.infer<typeof AutoApproveCategorySchema>;

const ModelOverrideSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

const MinuteRangeSchema = (max: number) =>
  z
    .object({ min: z.number().int().min(1).max(max), max: z.number().int().min(1).max(max) })
    .refine((range) => range.min <= range.max, { message: 'Le minimum dépasse le maximum' });

/**
 * A time-waster and his scarce attention (ADR 0135), per creator: no value in the repository, the agency enters them.
 * The waits are drawn in a range, capped at 8 h for « slowed » (§ 6) and a day for « dormant ».
 */
export const TimeWasterSettingSchema = z.object({
  /** Her scripts sent to him that he never entered, before he counts as a time-waster. */
  minUnenteredScripts: z.number().int().min(1).max(50),
  /** Known this long with nothing paid on top: the « proven » level, which a tiresome fan turns « dormant ». */
  provenHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365),
  slowedDelayMinutes: MinuteRangeSchema(8 * 60),
  dormantDelayMinutes: MinuteRangeSchema(24 * 60),
  /** Her answers to him a day, at most (§ 6: two moments « slowed », one « dormant » at the start). */
  slowedRepliesPerDay: z.number().int().min(1).max(10),
  dormantRepliesPerDay: z.number().int().min(1).max(10),
});
export type TimeWasterSetting = z.infer<typeof TimeWasterSettingSchema>;

export const CreatorSettingsSchema = z.object({
  llm: z
    .object({
      /** Per-role model override; a role left out uses the gateway default (ADR 0009). */
      roles: z.partialRecord(LlmRoleSchema, ModelOverrideSchema).default({}),
      contextBudgetTokens: z.number().int().min(1000).max(200_000).default(12_000),
    })
    .prefault({}),
  autoApproveCategories: z.array(AutoApproveCategorySchema).default([]),
  retention: z
    .object({
      /** security.md: facts expire 12 months after the fan's last contact, fan media after 30 days. */
      factMonthsAfterLastContact: z.number().int().min(1).max(60).default(12),
      fanMediaDays: z.number().int().min(1).max(365).default(30),
    })
    .prefault({}),
  /** Her two switches of the extension's copilot panel (ADR 0086 § 6): the fan's card on, the agent's drafts off. */
  copilot: z.object({ fanCard: z.boolean().default(true), drafts: z.boolean().default(false) }).prefault({}),
  /** The thresholds of her fans' tiers, in euro cents, set by the owner (Charles, 21/11). */
  fanTiers: FanTiersSettingSchema.prefault({}),
  /** Her time-waster rule (ADR 0135), set by the owner or a manager; absent, nobody is a time-waster. */
  timeWaster: TimeWasterSettingSchema.optional(),
  /**
   * Translation for the nets (ADR 0168 § 5, amended 27/11): his message in a language the nets do not read is
   * translated into French, the nets read both, and her draft may leave without a human when nothing is raised. Off
   * by default: the owner turns it on after the cost is known.
   */
  translateForNets: z.boolean().default(false),
});
export type CreatorSettings = z.infer<typeof CreatorSettingsSchema>;
