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
  PlatformSchema,
  SessionStateSchema,
} from './enums';
import { FanFlagNameSchema, FanFlagsSchema } from './fans';
import {
  CommissionStatementIdSchema,
  ContentDropIdSchema,
  ContentRequestIdSchema,
  ContractorDocumentIdSchema,
  ConversationIdSchema,
  CreatorIdSchema,
  DraftIdSchema,
  FanIdSchema,
  InvoiceIdSchema,
  MediaAssetIdSchema,
  MessageIdSchema,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from './ids';
import {
  ContractorDocumentKindSchema,
  InvoiceKindSchema,
  InvoiceNotIssuedReasonSchema,
  InvoiceNumberSchema,
  InvoicePdfPlaceSchema,
  PayoutBlockSchema,
} from './invoices';
import { CurrencySchema } from './money';
import { BankedObjectionKindSchema, ObjectionReplyIdSchema } from './objections';
import { PayPeriodSchema } from './pay-periods';
import { SaleSellerSchema, SaleTypeSchema, SalesFeedSignalSchema } from './sales-feed';
import { SecurityAlertPayloadSchema } from './security';

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
  /**
   * The fan's last message was still unanswered when the draft ended, as the command saw it. On `draft_expired` (a
   * kill switch or an expired session): the conversation waits for an answer again, and the resume answers it (recette
   * MOT-03). On `draft_rejected`: the conversation stays with the human who refused it (recette CHAT-25). Absent
   * everywhere else, and on the events written before: they replay as they were decided.
   */
  leavesFanWaiting: z.literal(true).optional(),
  /**
   * On `draft_created`: written in the care mode (ADR 0088), a human validates it whatever the mode; `help`, it closes
   * on the fixed help bubble, given once per episode. Absent everywhere else.
   */
  care: z.object({ help: z.boolean() }).optional(),
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
  /**
   * He asks for something she does not sell, made for him (ADR 0090): a chatter on shift takes the order, priced and
   * timed by them, never by the agent. Ranked « important », never urgent: nothing is set on his limits.
   */
  'custom_order',
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

const minorAmount = z.number().int().min(0);

/**
 * A sale read in a platform's register for the first time, fresh (CRM-04): published in the transaction that records
 * it, never for a line read again, released from quarantine or older than the ring window. The amounts are the
 * platform's, in integer cents of `currency`; the seller is the owner's link of its chatter. Never the fan, neither his
 * id nor his pseudo, and the creator never reads it (ADR 0053).
 */
const saleDetectedPayload = z.object({
  saleId: SalesLineIdSchema,
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  saleType: SaleTypeSchema,
  occurredAt: z.iso.datetime(),
  currency: CurrencySchema,
  grossInclVatMinor: minorAmount,
  netMinor: minorAmount,
  agencyMinor: minorAmount,
  creatorMinor: minorAmount,
  seller: SaleSellerSchema,
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
  'custom_order_opened',
  'objection_reply_used',
  'reply_skipped',
  'reply_deferred',
  'desire_scored',
  'care_opened',
  'care_closed',
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
  'ai_credits_low',
  'backup_overdue',
  'exchange_rate_overdue',
  'invoice_not_issued',
  'invoice_pdf_conflict',
  'invoice_pdf_missing',
  'invoice_contested',
  'invoice_due_soon',
  'invoice_overdue',
  'contractor_document_expiring',
  'automatic_closed',
  'fan_flag_set',
  'fan_flag_cleared',
  'fan_fragile_dismissed',
  'sales_feed_signal',
  'sales_feed_mismatch',
  'agency_share_mismatch',
  'agency_share_changed',
  'connection_state_changed',
  'security_alert',
  'content_drop_received',
  'content_media_expiring',
  'content_media_erased',
  'content_media_erase_failed',
  'error',
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * At most this many days in one `sales_feed_mismatch` (CRM-04 b3): sixteen days for some thirty accounts. The check
 * keeps the first ones by day and account; the rest is in the check of Réglages.
 */
export const SALES_FEED_MISMATCH_DAYS_MAX = 500;

/**
 * The services whose outage `connection_state_changed` tells (Telegram P3-12): the AI providers of Réglages › Modèles
 * IA and the sales register of Reveal. Venice, a fallback, is not watched; `meta` enters with its publisher (PUB-02).
 */
export const CONNECTION_SERVICES = ['xai', 'mistral', 'google', 'elevenlabs', 'reveal_crm'] as const;
export const ConnectionServiceSchema = z.enum(CONNECTION_SERVICES);
export type ConnectionService = z.infer<typeof ConnectionServiceSchema>;

/**
 * Why a service is down: its key refused (401/403, a permission or a model withdrawn), its credit low or spent, or no
 * answer for long enough (`unreachable`). No source tells an expired key from a refused one: both are `refused`.
 */
export const ConnectionDownReasonSchema = z.enum(['refused', 'low_credit', 'unreachable']);
export type ConnectionDownReason = z.infer<typeof ConnectionDownReasonSchema>;

/** What a publisher saw of a service; the outbox keeps only the transitions (`publishConnectionState`). */
export type ConnectionSignal =
  { readonly state: 'down'; readonly reason: ConnectionDownReason } | { readonly state: 'back' };

/**
 * What the due date's alert says of an invoice (EQ-06 lot 8): its number, its due date and its total including VAT,
 * and, when the transfer that will pay it cannot be recorded today (ADR 0041, `payout_blocked_conflict`), why
 * (`payoutBlock`): a blocked transfer may pass the due date, and the late-payment penalties and the 40 € indemnity
 * with it. `null` when nothing stops it, or no statement can pay it yet.
 */
const invoiceDuePayload = z.object({
  invoiceId: InvoiceIdSchema,
  memberId: TeamMemberIdSchema,
  number: InvoiceNumberSchema,
  dueOn: z.iso.date(),
  inclVatMinor: z.number().int().min(0),
  payoutBlock: PayoutBlockSchema.nullable(),
});

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
   * He asked for something made for him and his order now waits for the team (ADR 0090 § 4): taken by the chatter on
   * shift (beside a `handoff_requested` of cause `custom_order`), or answered without a yes, a price or a delay. It
   * stays open until a human takes the conversation (`takeover_started`); never two open at once.
   */
  custom_order_opened: z.object({ conversationId: ConversationIdSchema }),
  /**
   * A reply of her bank was given to the voice for a price objection (ADR 0090 § 9): its id only, never its text,
   * so that the same fan does not get it twice.
   */
  objection_reply_used: z.object({
    conversationId: ConversationIdSchema,
    objection: BankedObjectionKindSchema,
    replyId: ObjectionReplyIdSchema,
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
  /**
   * The care mode opens on a fan in distress (ADR 0088): the agent answers him with care, every answer validated by a
   * human, until a manager or the owner closes it. `signs`: the risks read, by the brain or by the safety net in code.
   */
  care_opened: z.object({
    conversationId: ConversationIdSchema,
    signs: z.array(z.string().min(1).max(64)).min(1).max(10),
  }),
  /** « Il va mieux »: a manager or the owner closes the care mode (ADR 0088 § 7); the actor is that person. */
  care_closed: z.object({
    conversationId: ConversationIdSchema,
    reason: z.string().trim().min(1).max(500).optional(),
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
  sale_detected: saleDetectedPayload,
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
   * A provider's AI credits, as the ledger counts them down (ADR 0091 § 4), fell under five days at the recent pace
   * (`low`), under two (`critical`) or to nothing (`empty`). Published with no creator by the hourly check, once per
   * provider, level and latest line of the ledger: a new top-up or reading starts a new episode.
   */
  ai_credits_low: z.object({
    provider: z.enum(['xai', 'mistral', 'google']),
    level: z.enum(['low', 'critical', 'empty']),
    balanceMinor: z.number().int(),
    currency: CurrencySchema,
    /** Days left at the pace; null when empty without a pace. */
    daysLeft: z.number().nonnegative().nullable(),
    runsOutOn: z.iso.date().nullable(),
    /** The latest line of the ledger when it was published: the episode's key. */
    entryId: z.uuid(),
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
   * An invoice's key does not hold its PDF as the base records it (ADR 0037 § 5 to 7). By stage: `render`, other bytes
   * in the first bucket after a crash, nothing written; `copy`, at `primary` the PDF missing or other bytes, nothing
   * copied, at a copy other bytes or a lock that is not the PDF's (none, or a longer one), nothing written;
   * `download`, the file at that place missing or other bytes, not served (the other place is tried, and served only
   * if it matches). Nothing is ever replaced; the owner looks into it. Published once per document, place and stage.
   * Never a name: the member by id, the document by its number.
   */
  invoice_pdf_conflict: z.object({
    invoiceId: InvoiceIdSchema,
    memberId: TeamMemberIdSchema,
    number: InvoiceNumberSchema,
    place: InvoicePdfPlaceSchema,
    stage: z.enum(['render', 'copy', 'download']),
  }),
  /**
   * The job gave up after its last attempt (ADR 0037 § 5 and 6): an invoice still has no PDF (`primary`), or its PDF
   * no copy at the provider named. The invoice stays valid; never published while the job still retries, and once
   * per document and place.
   */
  invoice_pdf_missing: z.object({
    invoiceId: InvoiceIdSchema,
    memberId: TeamMemberIdSchema,
    number: InvoiceNumberSchema,
    place: InvoicePdfPlaceSchema,
  }),
  /**
   * A contractor contested one of their documents, with a reason, before its delay ended (EQ-06 lot 6, ADR 0039 § 2):
   * published once per document by `payroll.announce_invoice_contest`, with no creator, for the owner, who alone
   * refuses the contest or upholds it. Never the reason nor a name: the owner reads them in the Paie.
   */
  invoice_contested: z.object({
    invoiceId: InvoiceIdSchema,
    memberId: TeamMemberIdSchema,
    number: InvoiceNumberSchema,
    document: InvoiceKindSchema,
  }),
  /**
   * An invoice not settled yet comes to its due date (EQ-06 lot 8): `invoice_due_soon` from `INVOICE_DUE_SOON_DAYS` days
   * before it, `invoice_overdue` from the day after, as the list computes its due state (`soon`, `overdue`). Published
   * once per invoice and type by `payroll.remind_due_invoices`, with no creator, for the owner; never for a credit note,
   * which a transfer takes off, nor for an invoice paid, imputed or compensated. Never a name: the member by id, the
   * invoice by its number.
   */
  invoice_due_soon: invoiceDuePayload,
  invoice_overdue: invoiceDuePayload,
  /**
   * Every file of her drop arrived whole in the media storage (CR-06 b): the receipt job publishes it in the
   * transaction that moves the drop to « Reçu », once per drop. The trend watch reads `requestId` to mark the idea
   * that asked for it (VEI-01 d).
   */
  content_drop_received: z.object({
    dropId: ContentDropIdSchema,
    requestId: ContentRequestIdSchema.nullable(),
  }),
  /**
   * An original she dropped goes in `DROP_ERASE_NOTICE_DAYS` days (CR-06 c, ADR 0055 § 7): for the agency, once per
   * medium and date, by `content_drops.erase_originals`. Its day (UTC), never its content.
   */
  content_media_expiring: z.object({ mediaAssetId: MediaAssetIdSchema, erasedOn: z.iso.date() }),
  /**
   * An original she dropped was erased from the media storage (ADR 0044 § 2): its fingerprint, length, type and
   * description stay. `withdrawn` when its drops were all withdrawn, `due` at its date.
   */
  content_media_erased: z.object({
    mediaAssetId: MediaAssetIdSchema,
    reason: z.enum(['due', 'withdrawn']),
  }),
  /**
   * The storage did not erase an original that was due (ADR 0044 § 2: amber, never silent): once per medium and date
   * (`erasedOn`, the date it was kept until), tried again each hour.
   */
  content_media_erase_failed: z.object({ mediaAssetId: MediaAssetIdSchema, erasedOn: z.iso.date() }),
  /**
   * A document a contractor's regime asks for comes to its end, or has passed it, and no newer one is filed (EQ-06 lot
   * 5c-2): a tax residence certificate from 1 December of its year (it is renewed in January), another from the
   * owner's delay before its last day (`documentReminderDays`). Published once per document by
   * `payroll.remind_documents`, with no creator, for the owner; the member sees it in his file. Never a name: the
   * member and the document by id.
   */
  contractor_document_expiring: z.object({
    memberId: TeamMemberIdSchema,
    documentId: ContractorDocumentIdSchema,
    kind: ContractorDocumentKindSchema,
    /** Its last valid day: past already when the reminder comes late. */
    lastDay: z.iso.date(),
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
  /**
   * A human set aside the proposal to mark him « fragile » (ADR 0085 § 9, lot b2): « À traiter » no longer shows it for
   * 30 days, unless a new sign of distress comes. The author is the actor; never a value of his card.
   */
  fan_fragile_dismissed: z.object({ fanId: FanIdSchema }),
  /**
   * The sales feed of a platform needs the owner (ADR 0050 § 3): a refused key, a value it does not know, a line for a
   * model linked to no creator account, a line read again changed, an answer it cannot read. Published with no
   * creator, never with a fan's id or pseudo, at most once per kind and value while it lasts.
   */
  sales_feed_signal: z.object({ platform: PlatformSchema, signal: SalesFeedSignalSchema }),
  /**
   * After a switch to the platform's net (ADR 0050 § 8, CRM-04 lot b3): the fortnight's automatic check found the
   * register and the platform's daily statistics apart on a net, and still apart 24 hours later. Only the accounts paid
   * on the platform's net for the whole fortnight; per day, account and currency, in signed cents (`differenceMinor` =
   * platform − register: positive when the register lacks money). Published with no creator, once per platform and fortnight; never a fan, never a chatter.
   * Information for the owner: pay never reads it.
   */
  sales_feed_mismatch: z.object({
    platform: PlatformSchema,
    from: PayPeriodSchema,
    to: z.iso.date(),
    days: z
      .array(
        z.object({
          day: z.iso.date(),
          platformAccountId: PlatformAccountIdSchema,
          currency: CurrencySchema,
          registerNetMinor: z.number().int(),
          platformNetMinor: z.number().int(),
          differenceMinor: z.number().int(),
        }),
      )
      .min(1)
      .max(SALES_FEED_MISMATCH_DAYS_MAX),
  }),
  /**
   * CRM-04 lot d3 (ADR 0054 § 2, question 5): on the fortnight just over, a creator's part as the platform reads it
   * (`modelRevenue`) differs from the agency's percentage set for her by more than one cent per sale and per refund, on
   * one account and in one currency. Only the days a percentage covers are compared, each with its own; `sales` and
   * `refunds` count them, and `expectedCreatorMinor` is the net less the agency's share, rounded to the cent. In signed cents (`differenceMinor` =
   * read − expected). Published once per account, fortnight and currency; never a fan, a chatter nor a seller.
   * Information for the owner: no amount changes, pay never reads it.
   */
  agency_share_mismatch: z.object({
    creatorId: CreatorIdSchema,
    platform: PlatformSchema,
    platformAccountId: PlatformAccountIdSchema,
    from: PayPeriodSchema,
    to: z.iso.date(),
    currency: CurrencySchema,
    sales: z.number().int().min(0),
    refunds: z.number().int().min(0),
    creatorMinor: z.number().int(),
    expectedCreatorMinor: z.number().int(),
    differenceMinor: z.number().int(),
  }),
  /**
   * ADR 0054 § 5: the agency's share as the platform reads it (Σ `agencyRevenue` / Σ net, in basis points, rounded)
   * moved by more than one point between the fortnight just over (`from`, `to`) and the one before it, on one account
   * and in one currency, both with a net. Published once per account, fortnight and currency; no percentage set for
   * her is needed. Information for the owner: no amount changes, pay never reads it.
   */
  agency_share_changed: z.object({
    creatorId: CreatorIdSchema,
    platform: PlatformSchema,
    platformAccountId: PlatformAccountIdSchema,
    from: PayPeriodSchema,
    to: z.iso.date(),
    currency: CurrencySchema,
    previousAgencyBps: z.number().int().min(0).max(10_000),
    agencyBps: z.number().int().min(0).max(10_000),
  }),
  /**
   * A service went down, or came back after a published `down` (Telegram P3-12). Published with no creator, at the
   * transition only, never at each check; `since` is when the publisher saw it. The rule of each service lives in its
   * publisher (`providers`, `connectors`). Never the key, never a word of the service's answer.
   */
  connection_state_changed: z.discriminatedUnion('state', [
    z.object({
      service: ConnectionServiceSchema,
      state: z.literal('down'),
      reason: ConnectionDownReasonSchema,
      since: z.iso.datetime(),
    }),
    z.object({ service: ConnectionServiceSchema, state: z.literal('back'), since: z.iso.datetime() }),
  ]),
  /**
   * A security alert (ADR 0046 § 8), written in the same transaction as the line of `audit_log` it tells, or right
   * after it. For the urgent Telegram groups: an account by id and role, a network, never a name nor a full address.
   */
  security_alert: SecurityAlertPayloadSchema,
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
  typedEvent('custom_order_opened'),
  typedEvent('objection_reply_used'),
  typedEvent('reply_skipped'),
  typedEvent('reply_deferred'),
  typedEvent('desire_scored'),
  typedEvent('care_opened'),
  typedEvent('care_closed'),
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
  typedEvent('ai_credits_low'),
  typedEvent('backup_overdue'),
  typedEvent('exchange_rate_overdue'),
  typedEvent('invoice_not_issued'),
  typedEvent('invoice_pdf_conflict'),
  typedEvent('invoice_pdf_missing'),
  typedEvent('invoice_contested'),
  typedEvent('invoice_due_soon'),
  typedEvent('invoice_overdue'),
  typedEvent('contractor_document_expiring'),
  typedEvent('automatic_closed'),
  typedEvent('fan_flag_set'),
  typedEvent('fan_flag_cleared'),
  typedEvent('fan_fragile_dismissed'),
  typedEvent('sales_feed_signal'),
  typedEvent('sales_feed_mismatch'),
  typedEvent('agency_share_mismatch'),
  typedEvent('agency_share_changed'),
  typedEvent('connection_state_changed'),
  typedEvent('security_alert'),
  typedEvent('content_drop_received'),
  typedEvent('content_media_expiring'),
  typedEvent('content_media_erased'),
  typedEvent('content_media_erase_failed'),
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
