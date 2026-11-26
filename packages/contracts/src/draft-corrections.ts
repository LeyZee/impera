import { z } from 'zod';

import { ConversationIdSchema, CreatorIdSchema, DraftIdSchema } from './ids';
import { REJECT_REASONS } from './playground';

/**
 * Entraîner › Corrections (trou béant 12, recette du 21/11): the drafts a human refused or retouched in real
 * conversations, with why, before and after side by side. The owner's alone, like the playground's corrections (ADR
 * 0092 § 8). Read only: nothing here changes a draft, a rate or her voice bank.
 */

/** How far back the screen reads, and how many lines at most (the newest). */
export const DRAFT_CORRECTIONS_DAYS = 30;
export const DRAFT_CORRECTIONS_MAX = 300;

/**
 * Why a draft was corrected: a reason of the closed list given from the copilot panel (the playground's, ADR 0086
 * § 4), a reason written in the Suivi (`written`), none (`none`), or retouched before it left (`edited`).
 */
export const DRAFT_CORRECTION_REASONS = [...REJECT_REASONS, 'written', 'none', 'edited'] as const;
export const DraftCorrectionReasonSchema = z.enum(DRAFT_CORRECTION_REASONS);
export type DraftCorrectionReason = z.infer<typeof DraftCorrectionReasonSchema>;

/** The screen's words; the closed reasons as the copilot panel says them. */
export const DRAFT_CORRECTION_REASON_LABELS: Readonly<Record<DraftCorrectionReason, string>> = {
  sounds_ai: 'Sonne IA',
  out_of_character: 'Hors personnage',
  too_long: 'Trop long',
  too_early_sexual: 'Trop tôt sexuel',
  missed_sale: 'Vente ratée',
  forgot_fact: 'A oublié un fait',
  other: 'Autre',
  written: 'Raison écrite',
  none: 'Sans raison',
  edited: 'Retouché',
};

/** One refused or retouched draft: what the agent wrote, and what left instead (null for a refusal). */
export const DraftCorrectionSchema = z
  .object({
    draftId: DraftIdSchema,
    conversationId: ConversationIdSchema,
    fanDisplayName: z.string(),
    at: z.iso.datetime(),
    kind: z.enum(['rejected', 'edited']),
    reason: DraftCorrectionReasonSchema,
    /** What the human wrote: the reason typed in the Suivi, or the note beside a closed reason. */
    note: z.string().min(1).nullable(),
    before: z.array(z.string()),
    after: z.array(z.string()).nullable(),
  })
  .strict();
export type DraftCorrection = z.infer<typeof DraftCorrectionSchema>;

/**
 * `GET /v1/creators/:creatorId/draft-corrections`: her corrections of the last `DRAFT_CORRECTIONS_DAYS` days, newest
 * first, `DRAFT_CORRECTIONS_MAX` at most (`truncated` when there were more), and how many there are of each reason
 * among them, in the order of `DRAFT_CORRECTION_REASONS`, only the reasons that have some.
 */
export const DraftCorrectionsViewSchema = z
  .object({
    creatorId: CreatorIdSchema,
    since: z.iso.datetime(),
    truncated: z.boolean(),
    counts: z.array(
      z.object({ reason: DraftCorrectionReasonSchema, count: z.number().int().positive() }).strict(),
    ),
    items: z.array(DraftCorrectionSchema),
  })
  .strict();
export type DraftCorrectionsView = z.infer<typeof DraftCorrectionsViewSchema>;
