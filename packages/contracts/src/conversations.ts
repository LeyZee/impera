import { z } from 'zod';

import { ExternalMediaSchema } from './connector';
import { DesireBandSchema, DesireScoreSchema, DesireSignalSchema, DESIRE_SIGNALS_MAX } from './desire';
import {
  ConversationModeSchema,
  ConversationStateSchema,
  DraftStatusSchema,
  MessageAuthorSchema,
  MessageDirectionSchema,
} from './enums';
import { EventBodySchema } from './events';
import { ConversationIdSchema, DraftIdSchema, FanIdSchema, MessageIdSchema } from './ids';
import { CurrencySchema } from './money';

/** DTOs of `/v1/conversations` (api.md): what the dashboard's inbox reads. Dates are ISO strings. */

/** Cursor pages (api.md § Pagination): `limit` 1 to 200, 50 by default; the cursor is opaque. */
export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export function pageOf<T extends z.ZodType>(
  item: T,
): z.ZodObject<{ items: z.ZodArray<T>; nextCursor: z.ZodNullable<z.ZodString> }> {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/**
 * His desire score as the tracking screens show it (P3-12): already cooled to the time of the answer (`desireNow`) and
 * its band taken from that cooled score, so the screen computes nothing. `null` while no `desire_scored` exists yet.
 */
export const ConversationDesireSchema = z.object({ score: DesireScoreSchema, band: DesireBandSchema });
export type ConversationDesire = z.infer<typeof ConversationDesireSchema>;

export const ConversationSummarySchema = z.object({
  id: ConversationIdSchema,
  fanId: FanIdSchema,
  fanDisplayName: z.string(),
  state: ConversationStateSchema,
  mode: ConversationModeSchema,
  lastInboundAt: z.iso.datetime().nullable(),
  lastOutboundAt: z.iso.datetime().nullable(),
  unreadCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
  desire: ConversationDesireSchema.nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const DraftViewSchema = z.object({
  id: DraftIdSchema,
  status: DraftStatusSchema,
  bubbles: z.array(z.string()),
  finalBubbles: z.array(z.string()).nullable(),
  createdAt: z.iso.datetime(),
});
export type DraftView = z.infer<typeof DraftViewSchema>;

export const ConversationDetailSchema = ConversationSummarySchema.extend({
  /** Drafts still waiting for a decision or being sent, oldest first. */
  openDrafts: z.array(DraftViewSchema),
  /**
   * While the conversation is in `error`: the draft whose send failed for good, so that a person reads what did not
   * leave and sends it in Reveal. `null` otherwise.
   */
  failedDraft: DraftViewSchema.nullable(),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

/**
 * One media of a message, as Suivi shows it (SUIVI-26): its kind and lock as the platform listed it, and what it shows
 * (`MediaDescription.factualDescription`) once the `media` module described and kept it, `null` before. No thumbnail:
 * Nirvana keeps no picture of a message's media.
 */
export const MessageMediaViewSchema = ExternalMediaSchema.pick({ kind: true, isLocked: true }).extend({
  description: z.string().min(1).nullable(),
});
export type MessageMediaView = z.infer<typeof MessageMediaViewSchema>;

export const MessageViewSchema = z.object({
  id: MessageIdSchema,
  direction: MessageDirectionSchema,
  author: MessageAuthorSchema,
  text: z.string(),
  /** Its media, in the platform's order; none for a text. */
  media: z.array(MessageMediaViewSchema),
  priceMinor: z.number().int().min(0).nullable(),
  currency: CurrencySchema.nullable(),
  isPaid: z.boolean(),
  draftId: DraftIdSchema.nullable(),
  platformCreatedAt: z.iso.datetime(),
});
export type MessageView = z.infer<typeof MessageViewSchema>;

export const ConversationEventViewSchema = z.intersection(
  z.object({ seq: z.number().int().min(1), actor: z.string(), createdAt: z.iso.datetime() }),
  EventBodySchema,
);
export type ConversationEventView = z.infer<typeof ConversationEventViewSchema>;

/** At most this many points in the reader's desire curve: the most recent ones. */
export const DESIRE_POINTS_MAX = 200;

/**
 * One point of the reader's desire curve: one `desire_scored` event. `before` is the stored score cooled to this
 * message (`null` on the first point); the cooling between two messages reads as the gap between a point's `score` and
 * the next one's `before`.
 */
export const DesirePointSchema = z.object({
  at: z.iso.datetime(),
  before: DesireScoreSchema.nullable(),
  score: DesireScoreSchema,
  signals: z.array(DesireSignalSchema).max(DESIRE_SIGNALS_MAX),
});
export type DesirePoint = z.infer<typeof DesirePointSchema>;

/** `GET /conversations/:id/desire`: the points, oldest first. */
export const DesireCurveSchema = z.object({ points: z.array(DesirePointSchema).max(DESIRE_POINTS_MAX) });
export type DesireCurve = z.infer<typeof DesireCurveSchema>;

/** Bodies of the dashboard's commands. */
export const ApproveDraftBodySchema = z.object({
  /** Present when the operator edited the bubbles before approving. */
  bubbles: z.array(z.string().trim().min(1).max(2_000)).min(1).max(10).optional(),
});
export const RejectDraftBodySchema = z.object({ reason: z.string().trim().min(1).max(500).optional() });
export const TakeoverBodySchema = z.object({ reason: z.string().trim().min(1).max(500).optional() });
/** `note`: what the chatter wants her to remember about the fan, kept as an `operator_note` fact (P3-02), one line. */
export const ReleaseBodySchema = z.object({ note: z.string().trim().min(1).max(300).optional() });
export const SetModeBodySchema = z.object({ mode: ConversationModeSchema });
