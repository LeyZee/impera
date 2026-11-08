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
 * What the panel reads every 5 s while it is shown (ADR 0086 § 9):
 * - `unknown`: Impera has not read this conversation yet;
 * - `off`: her drafts are off in the extension, the card may still be on;
 * - `none`: no draft is waiting;
 * - `writing`: the agent is writing one;
 * - `ready`: one is waiting, with its bubbles.
 */
export const CopilotDraftViewSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('unknown') }),
  z.strictObject({ state: z.literal('off'), conversation: CopilotConversationSchema }),
  z.strictObject({ state: z.literal('none'), conversation: CopilotConversationSchema }),
  z.strictObject({ state: z.literal('writing'), conversation: CopilotConversationSchema }),
  z.strictObject({
    state: z.literal('ready'),
    conversation: CopilotConversationSchema,
    draft: CopilotDraftSchema,
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
