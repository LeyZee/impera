import type {
  Actor,
  FanStanding,
  FanTiersSetting,
  AfterSaleType,
  AlertTrigger,
  BankedObjectionKind,
  CopilotTrace,
  DraftTranslation,
  CustomAlertGroupId,
  CustomAlertId,
  EventId,
  SystemAlertCode,
  AgentHours,
  DatedRanges,
  ConversationDetail,
  ConversationEventView,
  ConversationHolder,
  ConversationId,
  ConversationMode,
  ConversationState,
  ConversationSummary,
  CreatorConversation,
  CreatorFanPage,
  CreatorFanInsights,
  CreatorId,
  CreatorMessagePage,
  Currency,
  DecidedDraft,
  DesireCurve,
  DesireSignal,
  FanAvailabilityRecord,
  DraftId,
  DraftStatus,
  EventBody,
  ExternalMedia,
  ExternalRef,
  FactCategory,
  FactKind,
  FanCardRead,
  FanFlags,
  FanId,
  GuardCode,
  MediaAssetId,
  HandoffCause,
  JobName,
  JobPayload,
  MessageAuthor,
  MessageDirection,
  MessageId,
  MessageOrigin,
  MessageView,
  Money,
  OpenCustomOrder,
  OutboundMedia,
  PlatformAccountId,
  SafetyEvent,
  SaleTroubleKind,
  ScriptRunId,
  ScriptRunStatus,
  ScriptStepKind,
  ScriptStepOutcome,
  SendResult,
  UserId,
  Verdict,
  VerifyResult,
  CopilotSwitches,
  Platform,
} from '@impera/contracts';

import type { CustomOrderTurn } from '../../custom-orders/pure';

import type { AwayStatus } from './away';
import type { CopilotLive } from './copilot-assist';
import type { ConversationProjection } from './projection';
import type { ToTalkCandidate } from './to-talk';

/** Ports of the `conversations` module (ADR 0002): what it needs, implemented in `infra/` or by other modules. */

export interface Clock {
  now(): Date;
}

interface ConversationKey {
  readonly id: ConversationId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly fanId: FanId;
  readonly platformConversationId: string;
}

export type Conversation = ConversationKey & ConversationProjection;

interface NewMessage {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly platformAccountId: PlatformAccountId;
  readonly platformMessageId: string;
  readonly direction: MessageDirection;
  readonly author: MessageAuthor;
  readonly text: string;
  readonly priceMinor: number | null;
  readonly currency: Currency | null;
  readonly isPaid: boolean;
  readonly platformCreatedAt: Date;
  readonly draftId: DraftId | null;
  /** The media the platform listed on it; empty for what we send. */
  readonly platformMedia: readonly ExternalMedia[];
  /** Which automation of the platform wrote it, or a fan's reply to a story (ADR 0110); absent otherwise. */
  readonly origin?: MessageOrigin;
}

export interface Draft {
  readonly id: DraftId;
  readonly conversationId: ConversationId;
  readonly status: DraftStatus;
  readonly bubbles: readonly string[];
  readonly finalBubbles: readonly string[] | null;
  readonly createdAt: Date;
  /** When a chatter put it in the platform's field from the copilot panel (ADR 0086 § 4); `null` until then. */
  readonly placedAt: Date | null;
  /** Who placed it; `null` until then. */
  readonly placedBy: UserId | null;
  /** What the brief learnt about the fan for this draft, written as facts once a human approves it (P3-02). */
  readonly facts: readonly DraftFact[];
  /** The step of her script the code decided with this draft (ADR 0098): it leaves after the bubbles. */
  readonly scriptStep: DraftScriptStep | null;
}

/**
 * A step of a platform script that goes with a draft (ADR 0098 § 5): the platform sends its text, media and price, at
 * the price the code decided (`priceMinor`, 0 for an offered step or a bridge), or nothing if that price changed.
 */
export interface DraftScriptStep {
  readonly scriptRef: string;
  readonly stepIndex: number;
  /** The step as the platform names it: what is sent (ADR 0112, a branch has no stable index). */
  readonly stepRef: string;
  readonly priceMinor: number;
  /** It sends a media of her vault: the bubbles may announce it (`media_not_sent` is not read). */
  readonly hasMedia: boolean;
  /** One key per conversation, script and step: a replay never sends it twice (ADR 0018 § 5). */
  readonly idempotencyKey: string;
}

/** A fact read in the fan's messages, kept with the draft until a human approves it (P3-02). */
export interface DraftFact {
  readonly category: FactCategory;
  readonly key: string;
  readonly value: string;
  readonly kind: FactKind;
  readonly confidence: number;
  /** The fan's message it was read in. */
  readonly sourceMessageId: MessageId | null;
  readonly observedAt: Date;
  /** The person who wrote it: a chatter's note left at the hand-back, when the job says who (trou béant 17). */
  readonly notedBy?: UserId;
}

export interface DraftDecision {
  readonly decidedBy: string | null;
  readonly at: Date;
  readonly finalBubbles?: readonly string[];
}

interface ConversationRepository {
  /**
   * Returns the conversation locked for the rest of the transaction, creating it on first sight. The lock makes
   * the transaction the single writer of this conversation's journal.
   */
  lockOrCreate(key: ConversationKey): Promise<Conversation>;
  /** Locks an existing conversation, or `null`. */
  lock(id: ConversationId): Promise<Conversation | null>;
  saveProjection(id: ConversationId, projection: ConversationProjection): Promise<void>;
  /** The creator's conversations in this mode. */
  idsInMode(mode: ConversationMode): Promise<readonly ConversationId[]>;
  /** The creator's conversations in this state, the one whose fan wrote first at the head. */
  idsInState(state: ConversationState): Promise<readonly ConversationId[]>;
  /**
   * The conversation of the fan this platform id names on this account (ADR 0156 § 2: a sale names him, not the
   * conversation), the one he last wrote in; `null` when no fan or no conversation of his is known.
   */
  idOfFan(platformAccountId: PlatformAccountId, platformFanId: string): Promise<ConversationId | null>;
  /**
   * Whether `userId` holds the conversation (EQ-13): it is routed to him, or it is in `human` and his takeover is the
   * last word on who holds it (no release nor handoff since).
   */
  isHeldBy(id: ConversationId, userId: UserId): Promise<boolean>;
}

/** A conversation still held by a team member who is no longer `active` (EQ-13). */
interface AwayHold {
  readonly creatorId: CreatorId;
  readonly conversationId: ConversationId;
  readonly userId: UserId;
  readonly status: AwayStatus;
}

/**
 * The conversations held by members who are away, read across creators on the admin connection: the job that hands
 * them back runs for no creator and no account. At most `limit`, the next run takes the rest.
 */
export interface AwayHolds {
  list(limit: number): Promise<readonly AwayHold[]>;
}

interface MessageRepository {
  /** `false` when the platform message is already known (unique per account): ingestion is idempotent. A known outbound
   * message still empty (a script step, recorded at send before the platform wrote it) takes the synced text and media;
   * a known outbound message the synced copy says paid becomes paid, never the reverse (ADR 0156 § 2). */
  insertIfNew(message: NewMessage): Promise<boolean>;
  /** Bubbles of this draft already on the platform; a retried send resumes after them. */
  countForDraft(draftId: DraftId): Promise<number>;
  /** The texts of the messages that left for this draft, in the order they were sent (ADR 0086 § 5). */
  textsForDraft(draftId: DraftId): Promise<readonly string[]>;
  /** The conversation's last `limit` messages, oldest first: what the engine reads. */
  history(conversationId: ConversationId, limit: number): Promise<readonly HistoryMessage[]>;
  /** What the fan bought and since when he writes, across the creator's conversations. */
  fanStats(fanId: FanId): Promise<FanStats>;
}

/** The voice prompt version and the model that wrote a draft: what the live rate is read by (ADR 0019). */
export interface DraftVoice {
  readonly voicePrompt: string;
  readonly voiceModel: string;
}

interface DraftRepository {
  lock(id: DraftId): Promise<Draft | null>;
  /** Drafts not yet sent nor closed (`pending`, `approved`, `edited`), oldest first. */
  openFor(conversationId: ConversationId): Promise<readonly Draft[]>;
  /** Whether a draft already carries this idempotency key (one word after a sale, ADR 0156 § 2). */
  existsWithKey(idempotencyKey: string): Promise<boolean>;
  /** Her answers written in this conversation since `since`, whatever became of them, and when the last one was. */
  paceSince(
    conversationId: ConversationId,
    since: Date,
  ): Promise<{ readonly count: number; readonly lastAt: Date | null }>;
  insert(draft: {
    id: DraftId;
    conversationId: ConversationId;
    idempotencyKey: string;
    createdAt: Date;
    bubbles?: readonly string[];
    /** Soft guard findings the operator should see next to the draft. */
    softViolations?: readonly string[];
    /** The blocking codes of a first answer set aside and written again (IA-08), shown under the draft. */
    retried?: readonly string[];
    /** The voice that wrote it, for the live rate (ADR 0019). */
    voice?: DraftVoice;
    /**
     * Her persona version it was written with, read by the composer with her persona. Absent, the version active
     * when it is saved: a composer that reads no version per creator (tests, the terminal).
     */
    personaVersionId?: string;
    /** Facts the brief proposed, confirmed when a human approves the draft (P3-02). */
    facts?: readonly DraftFact[];
    /** The step of her script decided with it (ADR 0098). */
    scriptStep?: DraftScriptStep;
    /** What the code decided with it, as the copilot panel reads it (ADR 0141 lot a). */
    copilot?: CopilotTrace;
    /** Its French for the team when she writes in another language (ADR 0168 § 9): shown, never sent. */
    translation?: DraftTranslation;
  }): Promise<void>;
  setStatus(id: DraftId, status: DraftStatus, decision?: DraftDecision): Promise<void>;
  /**
   * Marks a draft put in the platform's field from the copilot panel (ADR 0086 § 4), by whom and when; its status does
   * not move. `false` when it was already placed: the first placing is kept.
   */
  place(id: DraftId, placedBy: UserId, at: Date): Promise<boolean>;
  /**
   * Writes the draft's `live` calibration rating (ADR 0086 § 5), one per draft, with the voice that wrote it: `false`
   * when it already has one, or when no voice is known for it (a draft written by no model).
   */
  rateLive(id: DraftId, verdict: Verdict, at: Date): Promise<boolean>;
}

export interface EventMeta {
  readonly actor: Actor;
  readonly correlationId: string;
  readonly at: Date;
}

export interface StoredEvent {
  readonly seq: number;
  readonly body: EventBody;
  readonly actor: Actor;
  readonly at: Date;
}

interface EventWriter {
  /** Appends to the conversation's journal with the next `seq`; the caller holds the conversation's lock. */
  append(conversation: ConversationKey, body: EventBody, meta: EventMeta): Promise<number>;
  /** Writes the same event to the `domain_events` outbox, for the modules that react to it. */
  publish(creatorId: CreatorId, body: EventBody, meta: EventMeta): Promise<void>;
  /** The whole journal in `seq` order. */
  list(conversationId: ConversationId): Promise<readonly StoredEvent[]>;
  /** What set off each `alert_triggered` after `since` (all of them when null), in `seq` order (P4-01). */
  alertsSince(conversationId: ConversationId, since: Date | null): Promise<readonly AlertTrigger[]>;
  /**
   * Whether the team already knows no script is left for him (ADR 0150 § 9): a `scripts_exhausted` with no
   * `script_started` since. The episode lives in his journal, never in memory.
   */
  scriptsExhaustedSaid(conversationId: ConversationId): Promise<boolean>;
  /** How many times she teased him about a run he left (`script_abandon_teased`, Charles 20/11). */
  abandonTeases(conversationId: ConversationId, scriptRunId: ScriptRunId): Promise<number>;
  /**
   * What ADR 0090 reads in his journal: whether a custom order of his waits (a `custom_order_opened` with no
   * `takeover_started` since), and the replies of her objection bank he already received.
   */
  salesState(conversationId: ConversationId): Promise<SalesState>;
}

interface SalesState {
  readonly customOrderOpen: boolean;
  readonly usedObjectionReplies: readonly string[];
  /** When she last answered each sale trouble (`sale_trouble`), since the last takeover; `null`: never. */
  readonly saleTrouble: SaleTroubleSeen;
}

/** When she last answered a sale gone wrong for him (ADR 0156 § 4 and § 7). */
interface SaleTroubleSeen {
  readonly paymentHelpAt: Date | null;
  readonly complaintAt: Date | null;
}

interface JobOptions {
  readonly queueName?: string;
  readonly jobKey?: string;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
  /**
   * With a key: `replace` (the default) moves a waiting job to this run; `preserve_run_at` keeps its time and takes
   * this payload, so that a debounce under way is not cut short.
   */
  readonly jobKeyMode?: 'replace' | 'preserve_run_at';
}

/** Enqueues inside the current transaction (outbox, ADR 0006): a rollback drops the job with the state. */
interface JobEnqueuer {
  enqueue<J extends JobName>(job: J, payload: JobPayload<J>, options: JobOptions): Promise<void>;
}

/** Reasons the bot must not answer now (message-flow.md §6), read fresh by each job. */
/** `creator_archived`: her archiving stops the agent by code, whatever the switches say (ADR 0071 § 2). */
export type BlockedReason = 'creator_archived' | 'kill_switch' | 'session_expired';

interface RespondGate {
  blockedReason(conversation: ConversationKey): Promise<BlockedReason | null>;
  /** His limits as they are now (`fans.flags`), read in the transaction; `null` when they cannot be read. */
  fanFlags(conversation: ConversationKey): Promise<FanFlags | null>;
}

/** The creator's kill switch and the global one (message-flow.md §6): the latest row of each scope decides. */
interface KillSwitches {
  /**
   * Holds every other mode change of this creator until the transaction ends, so they apply in turn. `false` when the
   * creator does not exist (nothing to change).
   */
  lockCreator(): Promise<boolean>;
  /** She is archived (ADR 0071 § 2): her Arrêt is the code's, never a pause. */
  archived(): Promise<boolean>;
  /** `creatorUntil`: her switch is a pause that lifts itself then (ADR 0148 § 1); `null` otherwise. */
  isOn(): Promise<{
    readonly global: boolean;
    readonly creator: boolean;
    readonly creatorUntil: Date | null;
  }>;
  /**
   * Stamped by the database clock once the lock is held, so the later change is always the latest row. `until` makes
   * an Arrêt a pause: on until then, off after, without another row.
   */
  setCreator(entry: { active: boolean; reason: string; setBy: string; until?: Date }): Promise<void>;
}

/**
 * What opens Automatique (ADR 0019), for one voice version of the creator and the persona active for her now
 * (ADR 0022): the repository reads that persona itself, in the same statement.
 */
interface AutomaticEvidence {
  /** Whether she has an active persona version now: without one, nothing opens Automatique (recette 28/10, G4). */
  personaActive(): Promise<boolean>;
  /** Her decided drafts of this version, newest first, at most `LIVE_WINDOW`: approved as is, edited or rejected. */
  decided(voice: DraftVoice): Promise<readonly DecidedDraft[]>;
  /** The rate of the latest blind test of this version, in tenths of a percent; null before the first. */
  latestBlindTest(voice: DraftVoice): Promise<number | null>;
  /** Stamped by the database clock; returns that date. */
  recordBlindTest(entry: { voice: DraftVoice; ratePerMille: number; recordedBy: Actor }): Promise<Date>;
}

/** Everything a command touches, bound to one tenant transaction. */
/** A message of the conversation his card is read in (ADR 0085 § 7): his not read yet are new, the rest context. */
export interface CardReadMessage {
  readonly id: MessageId;
  readonly from: 'fan' | 'creator';
  readonly text: string;
  readonly isNew: boolean;
  readonly at: Date;
}

/** Where the reading of his card stands in a conversation (`conversations.card_read_at`, `card_read_through`). */
interface CardReads {
  /** His messages not read yet for his card (the one just in included), and when it was last read: the next read's time. */
  pace(
    conversationId: ConversationId,
  ): Promise<{ readonly unread: number; readonly lastReadAt: Date | null }>;
  /**
   * The conversation's last `limit` messages with words, oldest first, his not read yet marked new; `through` is when
   * the newest of those new ones came in, null when none did.
   */
  toRead(
    conversationId: ConversationId,
    limit: number,
  ): Promise<{ readonly messages: readonly CardReadMessage[]; readonly through: Date | null }>;
  /** His messages in up to `through` are read, at `at`. */
  markRead(conversationId: ConversationId, through: Date, at: Date): Promise<void>;
}

export interface Transaction {
  readonly conversations: ConversationRepository;
  readonly messages: MessageRepository;
  readonly cardReads: CardReads;
  readonly drafts: DraftRepository;
  readonly events: EventWriter;
  readonly jobs: JobEnqueuer;
  readonly gate: RespondGate;
  readonly switches: KillSwitches;
  readonly automatic: AutomaticEvidence;
  readonly audit: AuditTrail;
  readonly scriptRuns: ScriptRunRepository;
  /** His custom order (ADR 0159), kept by the custom-orders module; absent, no store is wired. */
  readonly customOrders?: CustomOrderJournal;
}

/** A turn that says something about his custom order. */
export type KeptCustomOrderTurn = Exclude<CustomOrderTurn, { readonly kind: 'none' }>;

/** His custom order under her tenant, in the turn's transactions (ADR 0159 § A.2): never across creators. */
interface CustomOrderJournal {
  /** His order still before her yes, or null. */
  open(fanId: FanId): Promise<OpenCustomOrder | null>;
  /** What the turn decided, kept once per message of his: the same message again changes nothing. */
  record(entry: {
    readonly fanId: FanId;
    readonly inboundMessageId: string;
    readonly turn: KeptCustomOrderTurn;
    readonly at: Date;
  }): Promise<void>;
}

/**
 * A script run with one fan (ADR 0098): its decision state only, which the agent's domain moves; what was sent and
 * bought is Reveal's to say (ADR 0018 § 5). Kept in `script_runs`, written in the turn's transaction.
 */
export interface ScriptRunState {
  readonly scriptRef: string;
  readonly status: ScriptRunStatus;
  readonly steps: readonly {
    readonly stepIndex: number;
    readonly kind: ScriptStepKind;
    readonly outcome: ScriptStepOutcome;
    readonly priceMinor: number | null;
    readonly sentAt: Date;
    readonly at: Date;
  }[];
  readonly ignoredMessages: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface StoredScriptRun {
  readonly id: ScriptRunId;
  readonly run: ScriptRunState;
}

/** `script_runs` under her tenant: never deleted, at most one open run per conversation. */
interface ScriptRunRepository {
  /** His latest run, open or ended; `null` when he never had one. */
  latest(conversationId: ConversationId): Promise<StoredScriptRun | null>;
  /** Opens a run; `null` when he already has one open. */
  open(conversationId: ConversationId, run: ScriptRunState): Promise<StoredScriptRun | null>;
  /** Saves a run; `false` when it was no longer open (another turn closed it). */
  save(stored: StoredScriptRun): Promise<boolean>;
  /** His runs that went cold (`stalled`), latest first: a run he left there makes her tease him (Charles 20/11). */
  stalled(conversationId: ConversationId): Promise<StoredScriptRun[]>;
}

/** Who did what from the dashboard (`audit_log`, security.md), in the same transaction as the act. */
interface AuditTrail {
  record(entry: {
    userId: UserId;
    action: string;
    /** `conversation` unless named. */
    entity?: 'conversation' | 'kill_switch' | 'creator';
    entityId: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

export interface UnitOfWork {
  /** Runs `work` in one transaction scoped to the creator (`withTenant`, RLS). */
  inTenant<T>(creatorId: CreatorId, work: (tx: Transaction) => Promise<T>): Promise<T>;
}

/**
 * The hard guards of the agent's output (ADR 0012: never an AI, no meeting, no contact; her hard limits), read
 * again on the bubbles a chatter approves, rewritten or not (revue 09, G5). Implemented by the `agent` module, with
 * the limits of her active persona version, read before each approval (recette 28/10, G4).
 */
export interface BubbleGuard {
  /**
   * Her guards; `null` when she has no active persona version: nothing is approved (fail closed). A failed read
   * throws, and nothing is approved either.
   */
  forCreator(creatorId: CreatorId): Promise<CreatorBubbleGuard | null>;
}

/** The hard guards of one creator, read on the bubbles of one approval. */
interface CreatorBubbleGuard {
  check(
    bubbles: readonly string[],
    context: GuardReadContext,
  ): { readonly isBlocked: boolean; readonly codes: readonly GuardCode[] };
}

/**
 * What the guards read the approved bubbles against (P3-13): the conversation's last messages, oldest first, his and
 * hers, so that a bubble she already sent or a third closed question in a row shows. A draft never carries a media.
 */
export interface GuardReadContext {
  readonly history: readonly { readonly from: 'fan' | 'creator'; readonly text: string }[];
  /** A care episode is open (ADR 0088 § 3, § 5): the care guard reads the bubbles too, whoever wrote them. */
  readonly care?: boolean;
  /** The draft leaves with a step of her script that sends a media (ADR 0098): announcing it is no lie. */
  readonly hasMedia?: boolean;
}

/**
 * Her hours (P3-14), her dated exceptions from her today on (ADR 0148 § 3) and the clock they are read on
 * (`creators.timezone`), implemented by `persona`: the defaults when none is stored. `null` when she does not exist.
 */
export interface ReplyHours {
  of(creatorId: CreatorId): Promise<HerHours | null>;
}

export interface HerHours {
  readonly hours: AgentHours;
  readonly timeZone: string;
  readonly exceptions: DatedRanges;
}

/** The fan as `conversations` needs it; implemented by the `fans` module. */
export interface FanDirectory {
  upsertFanByPlatformId(sighting: {
    creatorId: CreatorId;
    platformAccountId: PlatformAccountId;
    platformFanId: string;
    displayName: string;
    seenAt: Date;
  }): Promise<{ readonly id: FanId }>;
  /** Writes what is new in these facts (append-only, the `fans` module decides); returns those written, none on a replay. */
  proposeFacts(
    creatorId: CreatorId,
    fanId: FanId,
    facts: readonly DraftFact[],
  ): Promise<readonly { readonly id: string; readonly category: FactCategory }[]>;
  /** His card as the AI's read gets it (ADR 0085 § 7): one line per field it shows. */
  cardLines(creatorId: CreatorId, fanId: FanId): Promise<readonly string[]>;
  /** What the AI read in his new messages, checked and written by the `fans` module (§ 6, § 8); returns those written. */
  proposeRead(
    creatorId: CreatorId,
    fanId: FanId,
    read: FanCardRead,
    sources: readonly { readonly number: number; readonly messageId: MessageId; readonly at: Date }[],
  ): Promise<readonly { readonly id: string; readonly key: string }[]>;
  /** His limits (`fans.flags`): a hand is never given back to the agent while his age is in doubt. */
  flags(creatorId: CreatorId, fanId: FanId): Promise<{ readonly ageDisputed?: unknown }>;
  /** Her active facts about this fan, as the engine reads them (sorted, 40 at most). */
  activeFacts(
    creatorId: CreatorId,
    fanId: FanId,
  ): Promise<
    readonly {
      readonly category: FactCategory;
      readonly key: string;
      readonly value: string;
      /** `declared` (he said it), `noted` (a human wrote it) or `inferred` (the brain guessed it). */
      readonly kind?: string;
      /** How sure the brain was; a declared age confirms only when sure (relecture Sécurité, #798). */
      readonly confidence?: number;
      /** His message the brain read it in: a declared age confirms only when the number is in it. */
      readonly sourceMessageId?: string | null;
    }[]
  >;
}

/**
 * Sending, implemented by the `connectors` module (P0-06): `conversations` does not depend on `connectors`
 * (dependency inversion, modules.md).
 */
export interface OutboundSender {
  sendText(conversation: ConversationKey, text: string, idempotencyKey: string): Promise<SendResult>;
  sendMedia(conversation: ConversationKey, media: OutboundMedia, idempotencyKey: string): Promise<SendResult>;
  /**
   * One step of a platform script, its text, media and price as the platform lists them (ADR 0018 § 5): refused for
   * good (`SendRefused`) when the platform already sent it to him or its price is no longer `expectedPrice`.
   */
  sendStep(
    conversation: ConversationKey,
    /** The script and its step (the branch that leaves) as the platform names them, on the conversation's account. */
    step: { readonly scriptRef: string; readonly stepRef: string },
    expectedPrice: Money,
    idempotencyKey: string,
  ): Promise<SendResult>;
  /** After a send whose outcome is unknown, whether the message reached the platform. */
  verifySent(
    conversation: ConversationKey,
    idempotencyKey: string,
    ref: ExternalRef | null,
  ): Promise<VerifyResult>;
}

/** A media of a message, as the platform listed it. */
interface HistoryMedia {
  readonly kind: ExternalMedia['kind'];
  readonly platformMediaId: string;
  readonly isLocked: boolean;
}

/** One message as the engine reads it. */
interface HistoryMessage {
  readonly id: MessageId;
  readonly direction: MessageDirection;
  readonly author: MessageAuthor;
  readonly text: string;
  readonly at: Date;
  readonly priceMinor: number | null;
  readonly isPaid: boolean;
  /** Its id on the platform: the connector reads a fresh link to its media there (a link expires). */
  readonly platformMessageId: string;
  /**
   * Every media the fan's message carries, screened or not: a message with a media is never answered on its text
   * alone (vision obligatoire). `kind` from the platform; locked when it sits behind a price.
   */
  readonly media: readonly HistoryMedia[];
  /** Which automation of the platform wrote it, or a fan's reply to a story (ADR 0110); null otherwise. */
  readonly origin: MessageOrigin | null;
}

interface FanStats {
  /** Paid messages (PPV bought), in minor units. */
  readonly spentMinor: number;
  readonly firstMessageAt: Date | null;
}

interface FanContext extends FanStats {
  /** Her active facts about the fan (`fans.activeFacts`), as « key : value », that both the brain and the voice read. */
  readonly notes: readonly string[];
  /** Those the brain reads alone (ADR 0085 § 9: when he has money, his attachment, his moods); never the voice. */
  readonly brainNotes?: readonly string[];
  /** The age his card gives, a whole number; under 18, a human answers him (recette AGE-13). */
  readonly cardAge?: number;
  /** His card's age was stated by him or noted by a human, not only guessed: an adult one confirms his age. */
  readonly cardAgeStated?: boolean;
}

/** A fact as the brief proposes it: its category is the model's word until `conversations` reads it (P3-02). */
export interface ProposedFact {
  readonly category: string;
  readonly key: string;
  readonly value: string;
  readonly kind: FactKind;
  readonly confidence: number;
}

export interface ComposeInput {
  readonly creatorId: CreatorId;
  readonly conversationId: ConversationId;
  readonly fanId: FanId;
  /** Ties the LLM calls to the draft (real cost per draft in `llm_calls`). */
  readonly draftId: DraftId;
  readonly correlationId: string;
  readonly now: Date;
  /** Where the conversation lives on the platform: the engine's vision fetches his media there. */
  readonly platformAccountId: PlatformAccountId;
  readonly platformConversationId: string;
  /** The last 40 messages, oldest first. */
  readonly history: readonly HistoryMessage[];
  readonly fan: FanContext;
  /**
   * Present for a follow-up (P3-10): he went silent after her answer, nothing of his is to be answered. The engine
   * decides whether one goes out (`held` with `no_reply` when not) and writes it like an answer, draft and guards.
   */
  readonly followUp?: FollowUpContext;
  /**
   * Present for her word after a sale of his (ADR 0156 § 2): a step he bought or a tip, nothing of his to answer. The
   * engine decides whether it goes out now (`held` with `no_reply`, and `retryAt` for her night) and writes it like a
   * follow-up: thanks and tenderness, nothing to buy.
   */
  readonly aftercare?: AftercareContext;
  /**
   * How many times she already waited on his last message (P3-11): 1 on the second pass after « attends, je
   * reviens », when she may no longer wait; absent otherwise.
   */
  readonly waited?: number;
  /**
   * The fan's desire score as last written (P3-12) and when it was computed: the engine lets it cool from then on.
   * Absent until he is first scored.
   */
  readonly desire?: { readonly score: number; readonly at: Date };
  /** Her hours (P3-14) as stored; absent, the defaults. They set her night and when a follow-up may go out. */
  readonly hours?: AgentHours;
  /** Her dated exceptions (ADR 0148 § 3), from her today on: a date that has one follows its ranges alone. */
  readonly exceptions?: DatedRanges;
  /** A custom order of his already waits for the team (ADR 0090 § A). */
  readonly customOrderOpen?: boolean;
  /**
   * His custom order as the custom-orders module keeps it (ADR 0159 § A.2), read in the turn's first transaction:
   * `null`, none open. Absent, no store is wired and she answers as before (ADR 0090 § A).
   */
  readonly openCustomOrder?: OpenCustomOrder | null;
  /** The replies of her objection bank he already received (ADR 0090 § B). */
  readonly usedObjectionReplies?: readonly string[];
  /** His latest script run, open or ended (ADR 0098); `null` when he never had one. */
  readonly scriptRun?: ScriptRunState | null;
  /** His runs before `scriptRun` that went cold, and her teases about `scriptRun` when he left it (Charles 20/11). */
  readonly scriptAbandon?: { readonly earlier: readonly ScriptRunState[]; readonly teased: number };
  /** His availability as last journaled (ADR 0103, amendement du 13/11); `null` before the first. */
  readonly fanAvailability?: FanAvailabilityRecord | null;
  /**
   * The care mode open on the conversation (ADR 0088): she answers him with care whatever he writes. `helpGiven`: the
   * help bubble already went out in this episode.
   */
  readonly care?: { readonly since: Date; readonly helpGiven: boolean };
  /** When she last answered a sale gone wrong for him (ADR 0156 § 4 and § 7); absent: never. */
  readonly saleTrouble?: SaleTroubleSeen;
}

/** An event of a script run this message journals, in order (ADR 0098 § 2). */
type ScriptRunJournalEvent =
  | { readonly type: 'script_started' | 'script_ended' }
  | {
      readonly type: 'script_step_sent' | 'script_step_opened' | 'script_step_refused';
      readonly stepIndex: number;
    };

/** What this message did to his script runs (ADR 0098): written with the draft, in the same transaction. */
interface ComposedScriptRun {
  /** His latest run as this message left it, with the events that say how. */
  readonly moved?: { readonly run: ScriptRunState; readonly events: readonly ScriptRunJournalEvent[] };
  /** A run opened at this message. */
  readonly opened?: { readonly run: ScriptRunState; readonly events: readonly ScriptRunJournalEvent[] };
  /** A paid step went into the draft: one `offer_made` at its catalogue price. */
  readonly offer?: { readonly amountMinor: number; readonly currency: Currency };
  /** The step decided, paid or not: it goes with the draft, once its run is written. */
  readonly step?: DraftScriptStep;
}

/**
 * The care mode the engine read with this result (ADR 0088): the signs that opened or kept it, and whether the draft
 * closes on the help bubble. On a hold, the AI could not answer him with care and a human writes to him.
 */
interface ComposedCare {
  readonly signs: readonly string[];
  readonly help: boolean;
}

/**
 * The desire score the engine computed with this result (P3-12), given only when it moved: `before` is the stored
 * score cooled down to now (`null` before the first), and differs from `score`. The band is `desireBandOf(score)`.
 */
interface ComposedDesire {
  readonly before: number | null;
  readonly score: number;
  /** The closed codes of the signals that moved it; a code may repeat (`suggestive_emoji` once per emoji). */
  readonly signals: readonly DesireSignal[];
  readonly weightsVersion: string;
}

/** Which follow-up this is, after which silence. */
/** The sale she thanks him for (ADR 0156 § 2). */
interface AftercareContext {
  readonly saleType: AfterSaleType;
  /** When he paid, as the platform dates it. */
  readonly occurredAt: Date;
}

export interface FollowUpContext {
  /** The index of the delay in `persona.follow_ups.delays_hours`, from 0. */
  readonly step: number;
  /** How many delays the persona has: the last step is `steps - 1`. */
  readonly steps: number;
  /** His last message: the silence the delays count from. */
  readonly silentSince: Date;
}

/** Why the engine wrote no draft. The first three hand the conversation to the chatters. */
export type HoldReason = 'guard_blocked' | 'handoff' | 'budget_reached' | 'llm_unavailable' | 'no_reply';

export type ComposeResult =
  | {
      readonly kind: 'draft';
      readonly bubbles: readonly string[];
      readonly softViolations: readonly string[];
      /** The blocking codes of a first answer set aside and written again (IA-08). */
      readonly retried?: readonly string[];
      readonly costUsd: number;
      readonly voice?: DraftVoice;
      /** Her persona version it was written with (ADR 0019): never the one active when it is saved. */
      readonly personaVersionId?: string;
      /** What the brief read about the fan in his messages. */
      readonly factsProposed?: readonly ProposedFact[];
      readonly desire?: ComposedDesire;
      /** His availability after this message, only when it changed: one `fan_availability_changed` (ADR 0103). */
      readonly fanAvailability?: FanAvailabilityRecord;
      /** Her alerts that went off on his message and only let a human know: one `alert_triggered` each (P4-01). */
      readonly alerts?: readonly ComposedAlert[];
      /** His custom order now waits for the team: one `custom_order_opened` (ADR 0090 § A). */
      readonly customOrderOpened?: true;
      /** The turn on his custom order (ADR 0159 § A.2): kept by the custom-orders store in the turn's transaction. */
      readonly customOrderTurn?: KeptCustomOrderTurn;
      /** A script would open for him and none is left: one `scripts_exhausted` per episode (ADR 0150 § 9). */
      readonly scriptsExhausted?: true;
      /** She answered a sale gone wrong: one `sale_trouble`, so that the same trouble again goes to a human. */
      readonly saleTrouble?: SaleTroubleKind;
      /** She teased him about the run he left: one `script_abandon_teased` on that run (Charles 20/11). */
      readonly abandonTeased?: true;
      /** The reply of her objection bank this draft was written with: one `objection_reply_used` (ADR 0090 § B). */
      readonly objectionReply?: { readonly objection: BankedObjectionKind; readonly replyId: string };
      readonly scriptRun?: ComposedScriptRun;
      /** Written in the care mode: a human validates it whatever the mode (ADR 0088 § 5). */
      readonly care?: ComposedCare;
      /** What the code decided with it, kept with the draft for the copilot panel (ADR 0141 lot a). */
      readonly copilot?: CopilotTrace;
      /** Its French for the team when she writes in another language (ADR 0168 § 9): shown, never sent. */
      readonly translation?: DraftTranslation;
    }
  | {
      readonly kind: 'held';
      readonly reason: HoldReason;
      /** Why a human must answer, when the engine knows (vision, conversation checks); `other` otherwise. */
      readonly cause?: HandoffCause;
      /** The alert that paused the agent (P4-01), carried by the handoff: never also an `alert_triggered`. */
      readonly trigger?: AlertTrigger;
      readonly detail: readonly string[];
      readonly costUsd: number;
      /**
       * With `no_reply`, not now but later. For a follow-up, her quiet hours: the same step is scheduled again at that
       * time, within `FOLLOW_UP_RETRY_MAX_HOURS`, otherwise it is cancelled. For an answer, she chose to wait
       * (« attends, je reviens », P3-11): the answer is tried once more at that time, within the bounds of
       * `deferredRespondAt`, otherwise nothing comes back.
       */
      readonly retryAt?: Date;
      readonly desire?: ComposedDesire;
      readonly fanAvailability?: FanAvailabilityRecord;
      readonly alerts?: readonly ComposedAlert[];
      readonly customOrderOpened?: true;
      readonly customOrderTurn?: KeptCustomOrderTurn;
      readonly scriptsExhausted?: true;
      /** His run moved by his message and Reveal only: no step goes without a draft. */
      readonly scriptRun?: Pick<ComposedScriptRun, 'moved'>;
      readonly care?: ComposedCare;
    };

/** An alert of hers that went off and only lets a human know (P4-01): named, never with what the fan wrote. */
interface ComposedAlert {
  readonly trigger: AlertTrigger;
  /** Sent to Telegram, as her alert says when it went off. */
  readonly notify: boolean;
}

/**
 * The engine behind `conversation.respond`, implemented by the agent's adapter and injected by the composition
 * root. It resolves the persona from `creatorId` itself. Called outside any transaction: it may take seconds.
 */
export interface DraftComposer {
  compose(input: ComposeInput): Promise<ComposeResult>;
}

/**
 * His card read again in his new messages (ADR 0085 § 7), implemented by the agent on the gateway's `brain`: `budget`
 * when the day's spend is at its alert (the card stops before a fan's answer would), `failed` when no model answered.
 */
export interface CardReader {
  read(input: {
    readonly creatorId: CreatorId;
    readonly conversationId: ConversationId;
    readonly card: readonly string[];
    readonly messages: readonly {
      readonly number: number;
      readonly from: 'fan' | 'creator';
      readonly text: string;
      readonly isNew: boolean;
    }[];
  }): Promise<
    | { readonly ok: true; readonly read: FanCardRead }
    | { readonly ok: false; readonly reason: 'budget' | 'failed' }
  >;
}

/**
 * The persona's follow-up delays (`persona.follow_ups`), implemented by the agent's adapter: hours after the fan's
 * last message, strictly increasing; empty when her follow-ups are off. Without this port nothing is scheduled.
 */
export interface FollowUpPlan {
  delaysHours(creatorId: CreatorId): Promise<readonly number[]>;
}

/**
 * Her typing rhythm (Charles, 16/11 : never her bubbles at once): how long each bubble takes her to type, the same
 * figures the playground shows (agent module's adapter), and the wait itself, a real timer outside the tests.
 */
export interface TypingRhythm {
  delaysMs(bubbles: readonly string[]): readonly number[];
  wait(ms: number): Promise<void>;
}

/** What a job handler logs through; the composition root passes the job's own logger. */
export interface JobLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * What a creator reads of her own account (CR-02, ADR 0042 § 2), through her own door (`withCreatorAccount`): her
 * creator is read in her account, never given by the caller. No author of a message is ever read (ADR 0021).
 */
export interface CreatorSpaceReader {
  fans(userId: UserId, page: PageRequest): Promise<CreatorFanPage>;
  /** The conversation she opens and its fan, `null` when she has none of that id; each opening is in the audit log. */
  openConversation(userId: UserId, id: ConversationId, ip: string): Promise<CreatorConversation | null>;
  /**
   * `null` when she has no conversation of that id. A read with no opening of hers of that conversation in the last
   * 15 minutes is written in the audit log as one (`details.via = 'messages'`): a direct call never reads the thread
   * without a trace, and the screen's reading every 30 s adds nothing.
   */
  messages(
    userId: UserId,
    id: ConversationId,
    page: PageRequest,
    ip: string,
  ): Promise<CreatorMessagePage | null>; /**
   * « Qui sont tes fans » (CR-15, ADR 0065, ADR 0074): figures on all her fans, at the last midnight in her time zone
   * before `now`; shares only, never a value a fan wrote nor a case's count.
   */
  fanInsights(userId: UserId, now: Date): Promise<CreatorFanInsights>;
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/**
 * What her media show, as the `media` module described and kept them (SUIVI-26; the composition root's adapter): the
 * latest description of each of these media that has one. Without it, a message's media are shown undescribed.
 */
export interface MediaDescriptions {
  of(creatorId: CreatorId, mediaAssetIds: readonly MediaAssetId[]): Promise<ReadonlyMap<string, string>>;
}

/** Read side of the dashboard (no lock, no event): implemented in `infra/db`. */
export interface ConversationReader {
  /**
   * Every conversation of the creator, or with `heldOnly` only those the reader holds: routed to him, or taken over by
   * him and not given back (ADR 0024, ADR 0025: a handover he took stays his until « Rendre la main »). Each says
   * whether the reader holds it.
   */
  list(
    creatorId: CreatorId,
    page: PageRequest,
    reader: { readonly userId: UserId; readonly heldOnly: boolean },
  ): Promise<Page<ConversationSummary>>;
  /**
   * « À qui parler maintenant » (Charles, 21/11): her conversations where a fan wrote or arrived lately, each with what
   * he spent and his flags, and her tier thresholds. With `heldOnly`, only those the reader holds.
   */
  toTalkCandidates(
    creatorId: CreatorId,
    reader: { readonly userId: UserId; readonly heldOnly: boolean },
  ): Promise<{ readonly candidates: readonly ToTalkCandidate[]; readonly tiers: FanTiersSetting }>;
  /**
   * Whether that account holds the conversation (routed to it, or its takeover not ended): how a member whose scope is
   * `self` reaches it outside his access window (ADR 0025).
   */
  isHeldBy(creatorId: CreatorId, id: ConversationId, userId: UserId): Promise<boolean>;
  /**
   * Who holds the conversation, for that account (EQ-13): `'you'`, `'other'` (another person: routed to them, or their
   * takeover not ended) or `null` (nobody, or no such conversation). A chatter in his window gives back his own hand
   * or a handoff nobody took, never another person's (ADR 0025).
   */
  holderOf(creatorId: CreatorId, id: ConversationId, userId: UserId): Promise<ConversationHolder | null>;
  /**
   * Whether that account holds a conversation of this fan: the fan's sheet (his limits, what is left to learn) is read,
   * never written, by the member who holds it (ADR 0025, recette 05/11 CHAT-03).
   */
  isFanHeldBy(creatorId: CreatorId, fanId: FanId, userId: UserId): Promise<boolean>;
  /**
   * A chatter's opening of the conversation and its fan's sheet, in the audit log, before he reads it (ADR 0025: every
   * sheet he opens is traced, never its content): written unless he opened it in the last 15 minutes, so that the
   * screen's reading every 30 s adds nothing and a direct call never reads without a trace. `false` when the creator
   * has no conversation of that id, and nothing is written.
   */
  traceOpening(
    creatorId: CreatorId,
    id: ConversationId,
    trace: { readonly userId: UserId; readonly ip: string; readonly via?: 'messages' | 'events' | 'desire' },
  ): Promise<boolean>;
  /**
   * A chatter's read of a fan's sheet on its own (`/fans/:id/flags`, `/fans/:id/kyc`), written as the opening of each
   * conversation of that fan unless one covers it (ADR 0025: every sheet he opens is in the audit log, never its
   * content). Nothing is written for a fan without a conversation: his sheet is then empty to a chatter anyway.
   */
  traceFanOpening(
    creatorId: CreatorId,
    fanId: FanId,
    trace: { readonly userId: UserId; readonly ip: string; readonly via: 'flags' | 'kyc' | 'card' },
  ): Promise<void>;
  /**
   * The text of those of these messages this fan sent her, by id (ADR 0085 § 5: the sentence a value of his card was
   * read in). Her messages, another fan's and unknown ids are left out.
   */
  fanMessageTexts(
    creatorId: CreatorId,
    fanId: FanId,
    messageIds: readonly MessageId[],
  ): Promise<ReadonlyMap<string, string>>;
  /** As the reader `userId` sees it: whether he holds it is his own. */
  get(creatorId: CreatorId, id: ConversationId, userId: UserId): Promise<ConversationDetail | null>;
  /** `null` when the creator has no such conversation, as for `get`: never an empty page that hides it. */
  messages(creatorId: CreatorId, id: ConversationId, page: PageRequest): Promise<Page<MessageView> | null>;
  events(
    creatorId: CreatorId,
    id: ConversationId,
    page: PageRequest,
  ): Promise<Page<ConversationEventView> | null>;
  /**
   * Its `desire_scored` events as the reader's curve: the most recent `DESIRE_POINTS_MAX`, oldest first; `null`
   * without such a conversation.
   */
  desireCurve(creatorId: CreatorId, id: ConversationId): Promise<DesireCurve | null>;
  /** Whether the latest global or creator-wide emergency stop of hers is on (recette CHAT-07). */
  sendingStopped(creatorId: CreatorId): Promise<boolean>;
  /** The platforms where a session of one of her accounts expired (recette REV-05), each once. */
  expiredSessions(creatorId: CreatorId): Promise<readonly Platform[]>;
}

/** The conversation open on the platform, as the copilot panel reads it (ADR 0086 § 3, § 9). */
export interface CopilotRead {
  readonly conversationId: ConversationId;
  readonly fanId: FanId;
  /** A fan's message waits for the agent's answer: « L'agent écrit… ». */
  readonly writing: boolean;
  /** Her two switches, Créatrices › (elle) › Agent (§ 6), read from her settings; unreadable, the defaults. */
  readonly switches: CopilotSwitches;
  /** What he spent, his tier, his last purchase (Charles, 21/11); `null` when the fan is not read. */
  readonly standing: FanStanding | null;
  /** The latest pending draft that has bubbles, if any. */
  readonly draft: {
    readonly id: DraftId;
    readonly bubbles: readonly string[];
    readonly createdAt: Date;
    readonly placedAt: Date | null;
    /** Its French for the team (ADR 0168 § 9); `null` without one. */
    readonly translation: DraftTranslation | null;
  } | null;
  /** What the code decided and what holds now, for the panel's lines (ADR 0141 lot a). */
  readonly live: CopilotLive;
}

export interface CopilotReader {
  /**
   * Her conversation of that id on the platform, `null` when she has none. With `trace`, a chatter's opening is written
   * in the audit log first, unless one covers it (ADR 0025, ADR 0086 § 7): the panel reads every 5 s.
   */
  read(
    creatorId: CreatorId,
    conversation: { readonly platform: Platform; readonly platformConversationId: string },
    trace?: { readonly userId: UserId; readonly ip: string },
  ): Promise<CopilotRead | null>;
}

/** Her own alerts' names, archived ones too (`alerts` module's adapter): the history names an alert as it was. */
export interface AlertNames {
  ofCreator(
    creatorId: CreatorId,
  ): Promise<ReadonlyMap<CustomAlertId, { readonly groupId: CustomAlertGroupId; readonly name: string }>>;
}

/**
 * One line of the history as the journal has it (P4-01): the alert that rang, or what the agent's safety did (recette
 * 16/11 AGE-05), one of the two. The alert's name is added by the route.
 */
export interface AlertTriggerRow {
  readonly id: EventId;
  readonly conversationId: ConversationId;
  readonly fanId: FanId;
  readonly fanDisplayName: string;
  readonly trigger: AlertTrigger | null;
  readonly safety: SafetyEvent | null;
  readonly pausedAgent: boolean;
  readonly at: Date;
  readonly seenAt: Date | null;
}

/** Which triggers to list: seen or not, one alert of hers (by the id of her row) or of the system's. */
export interface AlertTriggerFilter {
  readonly seen?: boolean | undefined;
  readonly alert?:
    | { readonly kind: 'custom'; readonly id: CustomAlertId }
    | { readonly kind: 'system'; readonly code: SystemAlertCode }
    /** One kind of what the agent's safety did. */
    | { readonly kind: 'safety'; readonly event: SafetyEvent }
    /** One of her alerts that never watched her: it has no trigger. */
    | { readonly kind: 'none' }
    | undefined;
}

/**
 * The history of her alerts (P4-01): her `alert_triggered` events, the `handoff_requested` that carry a trigger, and
 * what the agent's safety did (a hand-off for a minor or her budget, a care mode opened), newest first, with the agency's « vu » (`alert_seen`, owned here: a mark on an event of the journal).
 */
export interface AlertHistory {
  list(creatorId: CreatorId, filter: AlertTriggerFilter, page: PageRequest): Promise<Page<AlertTriggerRow>>;
  /** Marks one trigger seen, once; `false` when she has no trigger by that id. */
  markSeen(creatorId: CreatorId, id: EventId, userId: UserId): Promise<boolean>;
  /**
   * Marks seen every trigger of hers the list shows up to `untilId`, that one included, in the list's order and under
   * its filter; gives how many were not seen yet, or `null` when she has no trigger by that id.
   */
  markSeenUntil(
    creatorId: CreatorId,
    untilId: EventId,
    filter: Pick<AlertTriggerFilter, 'alert'>,
    userId: UserId,
  ): Promise<number | null>;
}
