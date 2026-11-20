import { z } from 'zod';

import { LlmRoleSchema } from './enums';

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
});
export type CreatorSettings = z.infer<typeof CreatorSettingsSchema>;
