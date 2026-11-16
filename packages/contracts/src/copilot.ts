import { z } from 'zod';

import { PlatformSchema } from './enums';
import { ConversationIdSchema, CreatorIdSchema, DraftIdSchema, FanIdSchema } from './ids';
import { RejectReasonSchema } from './playground';

/**
 * The copilot side panel of the extension (ADR 0086): what it reads next to the conversation open on the platform,
 * and the chatter's gestures on the agent's draft. The chatter sends himself, on the platform: what left is reconciled
 * with the draft later (§ 5), never on a click.
 */

/** A conversation id as the platform writes it in its address or its page: opaque, never parsed. */
export const PlatformConversationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/u);

export const CopilotDraftQuerySchema = z.strictObject({
  platform: PlatformSchema.default('reveal'),
  /** Needed only when two of the reader's creators have a conversation of that id (409 `copilot_creator_conflict`). */
  creatorId: CreatorIdSchema.optional(),
});

/** Her two switches, Créatrices › (elle) › Agent (ADR 0086 § 6): the fan's card on, the agent's drafts off, by default. */
export const CopilotSwitchesSchema = z.strictObject({
  /** « Fiche du fan dans l'extension ». */
  fanCard: z.boolean(),
  /** « Brouillons de l'agent dans l'extension ». */
  drafts: z.boolean(),
});
export type CopilotSwitches = z.infer<typeof CopilotSwitchesSchema>;

/** One switch or both; the other keeps its value. */
export const SetCopilotSwitchesBodySchema = z
  .strictObject({ fanCard: z.boolean().exactOptional(), drafts: z.boolean().exactOptional() })
  .refine((body) => body.fanCard !== undefined || body.drafts !== undefined, { message: 'Rien à changer' });

/** Which conversation of Impera the open one is: the panel reads the fan's card and the conversation by these ids. */
export const CopilotConversationSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  conversationId: ConversationIdSchema,
  fanId: FanIdSchema,
  switches: CopilotSwitchesSchema,
});

const DraftBubblesSchema = z.array(z.string().trim().min(1).max(2_000)).min(1).max(10);

/** The agent's draft waiting for the chatter, as the panel shows it. */
export const CopilotDraftSchema = z.strictObject({
  draftId: DraftIdSchema,
  bubbles: DraftBubblesSchema,
  createdAt: z.iso.datetime(),
  /** When a chatter put it in the platform's field (`a` or `e`), null before: it stays pending until reconciled. */
  placedAt: z.iso.datetime().nullable(),
});

/**
 * ADR 0141, lot a: what the agent already computed, shown to the chatter without a new AI call. Provisional copy of
 * the schema the Agent thread proposed on 16/11; its PR is authoritative. Every label is rendered by the server from a
 * closed list, never written by the AI.
 */

/** § 1: the gesture the code decided for this draft. */
export const CopilotNextMoveKindSchema = z.enum([
  'reply',
  'offer_step',
  'answer_objection',
  'custom_order_accept',
  'custom_order_decline',
  'custom_order_wait',
  'wait',
  'hand_over',
  'no_sale',
]);
export type CopilotNextMoveKind = z.infer<typeof CopilotNextMoveKindSchema>;

/** § 2: why the sale is blocked (the code's offer blocks). */
export const CopilotSaleBlockSchema = z.enum([
  'do_not_contact',
  'risk',
  'sales_frozen',
  'age_unconfirmed',
  'no_budget',
  'cooldown',
  'low_desire',
]);
export type CopilotSaleBlock = z.infer<typeof CopilotSaleBlockSchema>;

/** § 2: why the draft is held or rewritten. */
export const CopilotDraftReasonSchema = z.enum([
  'handoff',
  'care',
  'age_doubt',
  'llm_unavailable',
  'rewritten_once',
  'media_not_seen',
]);
export type CopilotDraftReason = z.infer<typeof CopilotDraftReasonSchema>;

const CopilotLabelSchema = z.string().trim().min(1).max(120);

export const CopilotNextMoveSchema = z.strictObject({
  kind: CopilotNextMoveKindSchema,
  label: CopilotLabelSchema,
  /** `offer_step` only: the price the code decided, in minor units. */
  priceMinor: z.number().int().nonnegative().nullable(),
  /** `no_sale` only. */
  block: CopilotSaleBlockSchema.nullable(),
  /** `no_sale` only: the block's French label, rendered by the server from one list in contracts. */
  blockLabel: CopilotLabelSchema.nullable().optional(),
});
export type CopilotNextMove = z.infer<typeof CopilotNextMoveSchema>;

/** § 3: where the sale stands. */
export const CopilotSaleStateSchema = z.strictObject({
  script: z
    .strictObject({
      name: CopilotLabelSchema,
      stepIndex: z.number().int().nonnegative(),
      stepCount: z.number().int().positive(),
    })
    .nullable(),
  nextStep: z
    .strictObject({ name: CopilotLabelSchema, priceMinor: z.number().int().nonnegative() })
    .nullable(),
  refusedSteps: z.array(CopilotLabelSchema).max(20),
  /** Labels of the objection replies already served to this fan. */
  usedObjections: z.array(CopilotLabelSchema).max(10),
  customOrderOpen: z.boolean(),
  /** An offer made, with neither answer nor purchase. */
  offerPending: z.boolean(),
});
export type CopilotSaleState = z.infer<typeof CopilotSaleStateSchema>;

/** § 4: signals, the direction only (the figure stays in the CRM). */
export const CopilotSignalsSchema = z.strictObject({
  desireTrend: z.enum(['up', 'down', 'flat']).nullable(),
  followUpDue: z.boolean(),
});

/** § 9: what the server cut; the panel says it, and then shows neither sale nor buttons. */
export const CopilotCutSchema = z.enum([
  'age_doubt',
  'care',
  'care_exit',
  'do_not_contact',
  'sales_frozen',
  'limits_unread',
]);
export type CopilotCut = z.infer<typeof CopilotCutSchema>;

/**
 * ADR 0141 § 4 bis: the moment to sell, a verdict of the code with the conditions it rests on, derived from the same
 * guards as the paid step. Provisional (Agent's PR is authoritative); no desire figure, ever. The panel words the
 * codes itself: the server sends no label here.
 */
export const SaleMomentVerdictSchema = z.enum(['good', 'soon', 'not_yet']);
export type SaleMomentVerdict = z.infer<typeof SaleMomentVerdictSchema>;

export const SaleConditionSchema = z.enum([
  'desire_below_threshold',
  'not_sexualizing',
  'availability_unconfirmed',
  'cooldown',
  'no_budget',
  'step_waiting',
  'age_unconfirmed',
  /** Sent only once the ADR 0112 § 9 counter exists. */
  'fan_messages',
  /** Met: the reason for `good`. */
  'fan_asks_for_paid',
]);
export type SaleCondition = z.infer<typeof SaleConditionSchema>;

export const SaleMomentSchema = z.strictObject({
  verdict: SaleMomentVerdictSchema,
  /** Missing conditions first. */
  conditions: z
    .array(
      z.strictObject({
        code: SaleConditionSchema,
        met: z.boolean(),
        /** `cooldown` only: when the last offer stops being too recent. */
        until: z.iso.datetime().nullable().exactOptional(),
        /** `fan_messages` only: how many messages of his are still needed. */
        remaining: z.number().int().positive().nullable().exactOptional(),
      }),
    )
    .max(3),
});
export type SaleMoment = z.infer<typeof SaleMomentSchema>;

export const CopilotAssistSchema = z.strictObject({
  nextMove: CopilotNextMoveSchema.nullable(),
  reasons: z.array(z.strictObject({ code: CopilotDraftReasonSchema, label: CopilotLabelSchema })).max(6),
  /** Null when a cut removes the sale. */
  sale: CopilotSaleStateSchema.nullable(),
  signals: CopilotSignalsSchema,
  cuts: z.array(CopilotCutSchema).max(6),
  /** Lot b: the buttons offered (empty when a cut removes them or at the cap). */
  buttons: z.array(z.enum(['hooks', 'objection'])).max(2),
  clicksLeftToday: z.number().int().nonnegative(),
  /** § 4 bis; null under a cut, absent from a server that does not send it yet. */
  saleMoment: SaleMomentSchema.nullable().exactOptional(),
});
export type CopilotAssist = z.infer<typeof CopilotAssistSchema>;

/**
 * What the panel reads every 5 s while it is shown (ADR 0086 § 9):
 * - `unknown`: Impera has not read this conversation yet;
 * - `off`: her drafts are off in the extension, the card may still be on;
 * - `none`: no draft is waiting;
 * - `writing`: the agent is writing one;
 * - `ready`: one is waiting, with its bubbles.
 * `assist` (ADR 0141) comes with `none` and `ready`; a server that does not send it yet leaves it out.
 */
export const CopilotDraftViewSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('unknown') }),
  z.strictObject({ state: z.literal('off'), conversation: CopilotConversationSchema }),
  z.strictObject({
    state: z.literal('none'),
    conversation: CopilotConversationSchema,
    assist: CopilotAssistSchema.nullable().exactOptional(),
  }),
  z.strictObject({ state: z.literal('writing'), conversation: CopilotConversationSchema }),
  z.strictObject({
    state: z.literal('ready'),
    conversation: CopilotConversationSchema,
    draft: CopilotDraftSchema,
    assist: CopilotAssistSchema.nullable().exactOptional(),
  }),
]);
export type CopilotDraftView = z.infer<typeof CopilotDraftViewSchema>;

/**
 * The chatter's gesture on a draft (ADR 0086 § 4), sent with the extension's link:
 * - `placed`: `a` or `e`, the text is in the platform's field (`edited` with `e`); the verdict comes from what left;
 * - `rejected`: `r`, a reason of the playground's closed list and an optional note; nothing is placed.
 * One gesture per draft: the same one sent again creates nothing, and a rejection after a placing is accepted.
 */
export const CopilotVerdictBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('placed'), creatorId: CreatorIdSchema, edited: z.boolean() }),
  z.strictObject({
    kind: z.literal('rejected'),
    creatorId: CreatorIdSchema,
    reason: RejectReasonSchema,
    note: z.string().trim().min(1).max(1_000).exactOptional(),
  }),
]);
export type CopilotVerdictBody = z.infer<typeof CopilotVerdictBodySchema>;

export const CopilotVerdictResultSchema = z.strictObject({
  draftId: DraftIdSchema,
  outcome: z.enum(['placed', 'rejected']),
  /** True when this gesture had already been recorded: nothing was written again. */
  replayed: z.boolean(),
});
export type CopilotVerdictResult = z.infer<typeof CopilotVerdictResultSchema>;

/** Where a calibration rating comes from: the playground, or a real draft through the panel (ADR 0086 § 5). */
export const CalibrationSourceSchema = z.enum(['playground', 'live']);
export type CalibrationSource = z.infer<typeof CalibrationSourceSchema>;
