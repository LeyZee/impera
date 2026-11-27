import { z } from 'zod';

import {
  CopilotDraftReasonSchema,
  CopilotNextMoveKindSchema,
  CopilotSaleBlockSchema,
  SaleMomentSchema,
  type CopilotDraftReason,
  type CopilotNextMove,
  type CopilotNextMoveKind,
  type CopilotSaleBlock,
} from './copilot';
import { LanguageSchema } from './fan-language';
import { StepPriceTraceSchema } from './step-price';

/**
 * ADR 0141 lot a: what the agent decided with a draft, kept beside it in `drafts.policy_trace` (codes and numbers only,
 * never a text of the AI nor of the fan) and turned into the panel's lines by the server. Read back through this schema:
 * a trace that does not read shows nothing.
 */
export const CopilotTraceSchema = z.strictObject({
  move: z.strictObject({
    kind: CopilotNextMoveKindSchema,
    /** `offer_step` only: the price the code decided, in cents. */
    priceMinor: z.int().nonnegative().nullable(),
    /** `no_sale` only: the block of the policy, when it is one of its own. */
    block: CopilotSaleBlockSchema.nullable(),
  }),
  reasons: z.array(CopilotDraftReasonSchema).max(6),
  /** His script in progress after this message, by its steps' indexes; `null` without one. */
  sale: z
    .strictObject({
      scriptRef: z.string().min(1).max(200),
      /** The script as the team knows it: the start of its description on her catalogue. */
      scriptName: z.string().trim().min(1).max(120),
      stepIndex: z.int().nonnegative(),
      stepCount: z.int().positive(),
      /** The next paid step and its price on her catalogue. */
      nextStep: z
        .strictObject({ stepIndex: z.int().nonnegative(), priceMinor: z.int().positive() })
        .nullable(),
      refusedStepIndexes: z.array(z.int().nonnegative()).max(20),
      /** A paid step sent, neither bought nor refused yet. */
      offerPending: z.boolean(),
    })
    .nullable(),
  saleMoment: SaleMomentSchema.nullable(),
  desireTrend: z.enum(['up', 'down', 'flat']).nullable(),
  /**
   * The language code decided for the draft (ADR 0168): hers, his as code read it (`unknown` when it cannot name it),
   * and whether it may only leave by a human (his or hers outside the guards' coverage). Absent on older drafts.
   */
  language: z
    .strictObject({
      reply: LanguageSchema,
      fan: z.union([LanguageSchema, z.literal('unknown')]).nullable(),
      humanOnly: z.boolean(),
    })
    .optional(),
  /** The staircase's decision on the paid step at this draft (ADR 0098, avenant du 27/11/2026). Absent on older drafts. */
  stepPrice: StepPriceTraceSchema.optional(),
});
export type CopilotTrace = z.infer<typeof CopilotTraceSchema>;

/** § 2: the blocks of the sale as the code says them (ADR 0141), one label each. */
export const COPILOT_SALE_BLOCK_LABELS: Readonly<Record<CopilotSaleBlock, string>> = {
  do_not_contact: 'Ne plus lui écrire',
  risk: 'Un risque bloque la vente',
  sales_frozen: 'Ventes gelées',
  age_unconfirmed: 'Âge pas encore confirmé',
  no_budget: 'Il a dit ne pas avoir d’argent',
  cooldown: 'Offre trop récente',
  after_purchase: 'Pause après achat',
  low_desire: 'Désir encore trop bas',
  he_came: 'Il vient de jouir',
};

/** § 2: why the draft is as it is, one label each. */
export const COPILOT_DRAFT_REASON_LABELS: Readonly<Record<CopilotDraftReason, string>> = {
  handoff: 'Un humain doit répondre',
  care: 'Il traverse un moment difficile : on ne vend pas',
  age_doubt: 'Doute sur son âge : un humain doit le lever',
  llm_unavailable: 'L’IA n’a pas pu écrire',
  rewritten_once: 'Réécrit une fois par une garde',
  media_not_seen: 'Son média n’a pas pu être vu',
};

/** § 1: one label per gesture, verb first; `offer_step` carries the step and its price. */
const MOVE_LABELS: Readonly<Record<Exclude<CopilotNextMoveKind, 'offer_step'>, string>> = {
  reply: 'Répondre',
  answer_objection: 'Répondre à son objection',
  custom_order_accept: 'Accepter sa demande sur mesure',
  custom_order_decline: 'Refuser sa demande sur mesure',
  custom_order_wait: 'Faire patienter sa demande sur mesure',
  wait: 'Attendre sa réponse à l’étape envoyée',
  hand_over: 'Rendre la main à un humain',
  no_sale: 'Ne rien vendre',
};

/** A step of a script as the panel names it: its rank, from 1. */
export const copilotStepName = (stepIndex: number): string => `Étape ${String(stepIndex + 1)}`;

/** Cents as the panel writes them: « 15 € », « 12,50 € ». */
export function copilotEuros(minor: number): string {
  const euros = Math.floor(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? `${String(euros)} €` : `${String(euros)},${String(cents).padStart(2, '0')} €`;
}

/** The gesture of a trace with its labels, every word from the lists above. */
export function copilotNextMove(move: CopilotTrace['move'], nextStepIndex: number | null): CopilotNextMove {
  const label =
    move.kind === 'offer_step'
      ? move.priceMinor === null
        ? 'Proposer l’étape suivante'
        : `Proposer ${nextStepIndex === null ? 'l’étape' : copilotStepName(nextStepIndex)} à ${copilotEuros(move.priceMinor)}`
      : MOVE_LABELS[move.kind];
  return {
    kind: move.kind,
    label,
    priceMinor: move.kind === 'offer_step' ? move.priceMinor : null,
    block: move.kind === 'no_sale' ? move.block : null,
    ...(move.kind === 'no_sale' && {
      blockLabel: move.block === null ? null : COPILOT_SALE_BLOCK_LABELS[move.block],
    }),
  };
}
