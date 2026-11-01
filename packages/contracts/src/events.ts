import { z } from 'zod';

import { AlertTriggerSchema } from './alerts';
import { AutomaticMissingSchema } from './automatic';
import { DESIRE_SIGNALS_MAX, DesireScoreSchema, DesireSignalSchema } from './desire';
import {
  ActorSchema,
  ConversationModeSchema,
  DraftStatusSchema,
  FactCategorySchema,
  MessageAuthorSchema,
  MessageDirectionSchema,
  SessionStateSchema,
} from './enums';
import { FanFlagNameSchema, FanFlagsSchema } from './fans';
import {
  CommissionStatementIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  DraftIdSchema,
  FanIdSchema,
  MediaAssetIdSchema,
  MessageIdSchema,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from './ids';
import { InvoiceKindSchema, InvoiceNotIssuedReasonSchema } from './invoices';
import { CurrencySchema } from './money';
import { PayPeriodSchema } from './pay-periods';

/**
 * The closed list of event types (data-model.md) and their payloads (camelCase, never media content, never a
 * secret). `conversation_events` and the `domain_events` outbox share the list.
 */

const messagePayload = z.object({
  messageId: MessageIdSchema,
  platformMessageId: z.string().min(1),
  direction: MessageDirectionSchema,
  author: MessageAuthorSchema,
  mediaIds: z.array(MediaAssetIdSchema),
});

const sendPayload = z.object({
  /** The conversation it belongs to: `send_failed` reaches the alerts, which close per conversation (ADR 0020). */
  conversationId: ConversationIdSchema,
  draftId: DraftIdSchema,
  idempotencyKey: z.string().min(1),
  attempt: z.number().int().min(1),
  error: z.string().min(1).optional(),
  /** `send_failed` only: no retry follows (last attempt, or a refusal such as a closed write guard). */
  isFinal: z.boolean().optional(),
});

const draftPayload = z.object({
  draftId: DraftIdSchema,
  status: DraftStatusSchema,
  decidedBy: UserIdSchema.optional(),
  editedBubbles: z.array(z.string()).optional(),
  /** Why a human rejected or the system expired it; kept for the evals (message-flow.md §3). */
  reason: z.string().min(1).max(500).optional(),
});

const factPayload = z.object({
  fanId: FanIdSchema,
  factId: z.uuid().optional(),
  summaryId: z.uuid().optional(),
  category: FactCategorySchema.optional(),
});

/**
 * A limit of a fan set or lifted (P3-02). Its author is the event's actor: a human (`human:<id>`) or the policy
 * (`system`), never a model alone. `flags` is the whole set after the change, so the journal alone tells his limits
 * at any date.
 */
const fanFlagPayload = z.object({
  fanId: FanIdSchema,
  flag: FanFlagNameSchema,
  flags: FanFlagsSchema,
  reason: z.string().min(1).max(500).optional(),
});

const controlPayload = z.object({
  userId: UserIdSchema.optional(),
  reason: z.string().min(1).optional(),
  mode: ConversationModeSchema.optional(),
});

/**
 * Why the agent hands a conversation to a human. Closed list: alerts rank on it (urgent or important), never on the
 * free `reason` text.
 */
export const HANDOFF_CAUSES = [
  'minor',
  'non_consent',
  'distress',
  'meeting',
  'manipulation',
  'guard',
  'budget',
  'keyword',
  /** No model answered (provider down, no key): nobody else would answer the fan. */
  'llm_unavailable',
  'other',
  /** One of her own alerts, checked « met en pause » (P4-01); one of her persona's words stays `keyword`. */
  'custom_alert',
  /** The system's alert « doute sur la personne » (P4-01): the fan doubts it is her; a chatter on shift answers. */
  'identity_doubt',
  /**
   * She has no active persona version, or it no longer reads (recette 28/10, G4): the agent writes nothing without
   * it (ADR 0010, 0022).
   */
  'persona_inactive',
] as const;
export const HandoffCauseSchema = z.enum(HANDOFF_CAUSES);
export type HandoffCause = z.infer<typeof HandoffCauseSchema>;

const handoffPayload = z.object({
  conversationId: ConversationIdSchema,
  cause: HandoffCauseSchema,
  /** A sentence a chatter reads, in French; never a machine code: those go in `detail`. */
  reason: z.string().min(1).max(500).optional(),
  /** What the engine held on, as codes (`guard_blocked`, `meeting_promise`…), for the journal: never shown as is. */
  detail: z.array(z.string().min(1).max(500)).max(20).optional(),
  /**
   * The alert that paused the agent (P4-01), with cause `keyword`, `custom_alert` or `identity_doubt`: no
   * `alert_triggered` then.
   */
  trigger: AlertTriggerSchema.optional(),
});

/** Who took the conversation, with its id: an alert sent for it is closed by this event (ADR 0020). */
const takeoverPayload = controlPayload.extend({ conversationId: ConversationIdSchema });

const commercePayload = z.object({
  offerId: z.uuid().optional(),
  saleId: z.uuid().optional(),
  amountMinor: z.number().int(),
  currency: CurrencySchema,
});

const scriptPayload = z.object({
  scriptRunId: z.uuid(),
  stepIndex: z.number().int().min(0).optional(),
});

const followUpPayload = z.object({
  jobKey: z.string().min(1),
  runAt: z.iso.datetime().optional(),
});

export const KillSwitchScopeSchema = z.enum(['global', 'creator', 'conversation']);
export type KillSwitchScope = z.infer<typeof KillSwitchScopeSchema>;

export const EVENT_TYPES = [
  'message_received',
  'message_sent',
  'send_attempted',
  'send_failed',
  'send_verified',
  'media_described',
  'draft_created',
  'draft_approved',
  'draft_edited',
  'draft_rejected',
  'draft_expired',
  'fact_proposed',
  'fact_confirmed',
  'fact_rejected',
  'summary_refreshed',
  'handoff_requested',
  'alert_triggered',
  'reply_skipped',
  'reply_deferred',
  'desire_scored',
  'takeover_started',
  'takeover_ended',
  'mode_changed',
  'kill_switch_toggled',
  'follow_up_scheduled',
  'follow_up_cancelled',
  'offer_made',
  'sale_detected',
  'script_started',
  'script_step_sent',
  'script_ended',
  'session_state_changed',
  'budget_threshold_crossed',
  'backup_overdue',
  'exchange_rate_overdue',
  'invoice_not_issued',
  'automatic_closed',
  'fan_flag_set',
  'fan_flag_cleared',
  'error',
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Payload schema of every event type. Adding a type here is a contract change (ADR 0007). */
export const EVENT_PAYLOADS = {
  message_received: messagePayload,
  message_sent: messagePayload,
  send_attempted: sendPayload,
  send_failed: sendPayload,
  send_verified: sendPayload,
  media_described: z.object({
    mediaAssetId: MediaAssetIdSchema,
    mediaDescriptionId: z.uuid(),
    model: z.string().min(1),
  }),
  draft_created: draftPayload,
  draft_approved: draftPayload,
  draft_edited: draftPayload,
  draft_rejected: draftPayload,
  draft_expired: draftPayload,
  fact_proposed: factPayload,
  fact_confirmed: factPayload,
  fact_rejected: factPayload,
  summary_refreshed: factPayload,
  handoff_requested: handoffPayload,
  /**
   * An alert that only lets a human know (P4-01): the agent goes on. One that pauses it is a `handoff_requested` with
   * its `trigger` instead, never both. Names the alert and how it matched, never what the fan wrote (ADR 0020).
   */
  alert_triggered: z.object({
    conversationId: ConversationIdSchema,
    trigger: AlertTriggerSchema,
    /**
     * Sent to Telegram: her alert's `notify` when it went off, always for the system's; kept in the history either
     * way.
     */
    notify: z.boolean(),
  }),
  /**
   * The engine answered nothing: the conversation goes back to `idle`. `llm_unavailable` is only read from older
   * journals; an unreachable model now hands the conversation to a human (`handoff_requested`, cause `llm_unavailable`).
   */
  reply_skipped: z.object({
    reason: z.enum(['no_reply', 'llm_unavailable']),
    detail: z.array(z.string().max(500)).max(20),
    /** She chose to wait (P3-11): her answer is tried again at that time, unless he writes first. */
    retryAt: z.iso.datetime().exactOptional(),
  }),
  /**
   * Out of her reply slots, with nobody on shift (P3-14): no draft, his message waits for `until`, the opening of her
   * next slot, when the answer is tried again. The conversation stays pending.
   */
  reply_deferred: z.object({ reason: z.enum(['outside_hours']), until: z.iso.datetime() }),
  /**
   * The engine's desire score of the fan changed (P3-12): written with the result it came with, only when it moved.
   * The conversation projects the last one; `before` is the stored score cooled down to that moment, `null` for the
   * first.
   */
  desire_scored: z.object({
    before: DesireScoreSchema.nullable(),
    score: DesireScoreSchema,
    signals: z.array(DesireSignalSchema).max(DESIRE_SIGNALS_MAX),
    weightsVersion: z.string().min(1).max(64),
  }),
  takeover_started: takeoverPayload,
  takeover_ended: takeoverPayload,
  mode_changed: controlPayload,
  kill_switch_toggled: z.object({
    scope: KillSwitchScopeSchema,
    scopeId: z.uuid().nullable(),
    active: z.boolean(),
    reason: z.string().min(1),
  }),
  follow_up_scheduled: followUpPayload,
  follow_up_cancelled: followUpPayload,
  offer_made: commercePayload,
  sale_detected: commercePayload,
  script_started: scriptPayload,
  script_step_sent: scriptPayload,
  script_ended: scriptPayload,
  session_state_changed: z.object({
    platformAccountId: PlatformAccountIdSchema,
    from: SessionStateSchema,
    to: SessionStateSchema,
  }),
  /** The day's LLM spend, all providers, crossed the alert threshold or reached the cap. Published with no creator. */
  budget_threshold_crossed: z.object({
    kind: z.enum(['alert', 'reached']),
    spentMinor: z.number().int().min(0),
    capMinor: z.number().int().min(0),
    currency: CurrencySchema,
    /** The budget's day, in its own time zone (Europe/Paris). */
    day: z.iso.date(),
  }),
  /**
   * No export of the database succeeded for 26 hours, or none ever did, in production (ADR 0028 § 5). Published with
   * no creator, at most once per day while it lasts.
   */
  backup_overdue: z.object({
    lastSucceededAt: z.iso.datetime().nullable(),
    /** The day of the check, in Europe/Paris: one alert per day. */
    day: z.iso.date(),
  }),
  /**
   * No ECB rate of a currency pay converts arrived for more than two weekdays (ADR 0033): the hourly job reads it and
   * publishes this with no creator, at most once per day and currency while it lasts. A closing already refuses a rate
   * too old (`exchange_rate_missing_conflict`); this tells the owner before.
   */
  exchange_rate_overdue: z.object({
    /** A currency pay converts, never the euro (`ForeignCurrencySchema` in payroll.ts, which imports this file). */
    currency: CurrencySchema.exclude(['EUR']),
    /**
     * The ECB's day of the last rate written; `null` when none ever came, which only production says, counted from the
     * day the job was first scheduled (ADR 0033).
     */
    lastRateDay: z.iso.date().nullable(),
    /** The day of the check, in the ECB's zone (Frankfurt): one alert per day. */
    day: z.iso.date(),
  }),
  /**
   * A document a validated statement made due was not issued (EQ-06, ADR 0036): its invoice, or a credit note the
   * period owes. Pay's invoicing job publishes it with no creator; the statement stays validated, and the owner settles
   * the reason (with the accountant for a credit note no invoice can take). Never a name: the member by id.
   */
  invoice_not_issued: z.object({
    memberId: TeamMemberIdSchema,
    statementId: CommissionStatementIdSchema,
    period: PayPeriodSchema,
    document: InvoiceKindSchema,
    reason: InvoiceNotIssuedReasonSchema,
    /** What stays without a document, excluding VAT, in cents: the invoice's total, or the credit owed. */
    amountMinor: z.number().int().min(1),
  }),
  /**
   * Automatique closed on its own (ADR 0019): the live rate fell under its target, or the voice version changed and
   * has not proved itself yet. Every conversation in automatic went back to the copilot. Published once, for the owner.
   */
  automatic_closed: z.object({
    voicePrompt: z.string().min(1),
    voiceModel: z.string().min(1),
    missing: z.array(AutomaticMissingSchema).min(1),
    conversations: z.number().int().min(1),
  }),
  fan_flag_set: fanFlagPayload,
  fan_flag_cleared: fanFlagPayload,
  error: z.object({
    code: z.string().min(1),
    jobName: z.string().min(1).optional(),
    retryable: z.boolean(),
  }),
} as const satisfies Record<EventType, z.ZodType>;

export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;

/** One `{ type, payload }` member per event type, so a parsed event narrows on `type`. */
const typedEvent = <T extends EventType>(type: T) =>
  z.object({ type: z.literal(type), payload: EVENT_PAYLOADS[type] });

export const EventBodySchema = z.discriminatedUnion('type', [
  typedEvent('message_received'),
  typedEvent('message_sent'),
  typedEvent('send_attempted'),
  typedEvent('send_failed'),
  typedEvent('send_verified'),
  typedEvent('media_described'),
  typedEvent('draft_created'),
  typedEvent('draft_approved'),
  typedEvent('draft_edited'),
  typedEvent('draft_rejected'),
  typedEvent('draft_expired'),
  typedEvent('fact_proposed'),
  typedEvent('fact_confirmed'),
  typedEvent('fact_rejected'),
  typedEvent('summary_refreshed'),
  typedEvent('handoff_requested'),
  typedEvent('alert_triggered'),
  typedEvent('reply_skipped'),
  typedEvent('reply_deferred'),
  typedEvent('desire_scored'),
  typedEvent('takeover_started'),
  typedEvent('takeover_ended'),
  typedEvent('mode_changed'),
  typedEvent('kill_switch_toggled'),
  typedEvent('follow_up_scheduled'),
  typedEvent('follow_up_cancelled'),
  typedEvent('offer_made'),
  typedEvent('sale_detected'),
  typedEvent('script_started'),
  typedEvent('script_step_sent'),
  typedEvent('script_ended'),
  typedEvent('session_state_changed'),
  typedEvent('budget_threshold_crossed'),
  typedEvent('backup_overdue'),
  typedEvent('exchange_rate_overdue'),
  typedEvent('invoice_not_issued'),
  typedEvent('automatic_closed'),
  typedEvent('fan_flag_set'),
  typedEvent('fan_flag_cleared'),
  typedEvent('error'),
]);
export type EventBody = z.infer<typeof EventBodySchema>;

const eventEnvelope = z.object({
  id: z.uuid(),
  actor: ActorSchema,
  correlationId: z.string().min(1),
  createdAt: z.iso.datetime(),
});

/** A row of `conversation_events`: ordered per conversation by `seq` (ADR 0007). */
export const ConversationEventSchema = z.intersection(
  eventEnvelope.extend({
    creatorId: CreatorIdSchema,
    conversationId: ConversationIdSchema,
    seq: z.number().int().min(1),
  }),
  EventBodySchema,
);
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;

/** A row of the `domain_events` outbox: what does not belong to one conversation (persona, session, kill switch). */
export const DomainEventSchema = z.intersection(
  eventEnvelope.extend({ creatorId: CreatorIdSchema.nullable() }),
  EventBodySchema,
);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
