import type {
  ChannelPostKind,
  ChannelPostViolation,
  CreatorId,
  SalesFeedReading,
  SalesRefunds,
  SalesTotals,
  TelegramBotId,
  TelegramBotState,
  TelegramChannelConfig,
  TelegramChatId,
  TelegramChatKind,
  TelegramDeliveryStatus,
  TelegramErrorKind,
  TelegramMembership,
  TelegramRoute,
  TelegramSaleSettingsEntry,
  TelegramTopic,
} from '@impera/contracts';

import type { ScannedEvent } from './signals';

/** Ports of the module (ADR 0020). The Postgres store seals tokens with CREDENTIALS_ENCRYPTION_KEYS. */

export interface BotRecord {
  readonly id: TelegramBotId;
  readonly telegramBotId: string;
  readonly username: string;
  readonly displayName: string;
  /** Null when it no longer decrypts (an encryption key dropped too early): the bot reads as to reconnect. */
  readonly token: string | null;
  readonly state: TelegramBotState;
  readonly updatesOffset: number;
  readonly lastPolledAt: Date | null;
}

export interface ChatRecord {
  readonly id: TelegramChatId;
  readonly botId: TelegramBotId;
  readonly telegramChatId: string;
  readonly title: string;
  readonly kind: TelegramChatKind;
  readonly membership: TelegramMembership;
  readonly canPost: boolean;
  readonly nextSendAt: Date | null;
  readonly lastSentAt: Date | null;
  readonly lastErrorKind: TelegramErrorKind | null;
}

type DeliveryAction = 'send' | 'edit' | 'reply';

export interface NewDelivery {
  readonly sourceKey: string;
  readonly chatId: TelegramChatId;
  readonly creatorId: CreatorId | null;
  readonly topic: TelegramTopic;
  readonly action: DeliveryAction;
  readonly parentId: string | null;
  readonly threadKey: string | null;
  readonly text: string;
  readonly summary: string;
  readonly isSilent: boolean;
  /** For an edit: whose name closes the original (« Pris en main par … »). */
  readonly closedBy: string | null;
}

/** A delivery as the « Dernières alertes » log reads it: its group may be gone (REG-28), its title stays. */
export interface LoggedDelivery extends Omit<DeliveryRecord, 'chatId'> {
  readonly chatId: TelegramChatId | null;
  readonly chatTitle: string;
}

export interface DeliveryRecord extends NewDelivery {
  readonly id: string;
  readonly status: TelegramDeliveryStatus;
  readonly attempts: number;
  readonly telegramMessageId: number | null;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
}

/** The sent message a closure acts on, in one group. */
export interface ThreadRoot {
  readonly id: string;
  readonly chatId: TelegramChatId;
  readonly creatorId: CreatorId | null;
  readonly topic: TelegramTopic;
  readonly text: string;
  /** Who closed it already; an edit never closes a message twice. */
  readonly closedBy: string | null;
}

interface LatestOfThread {
  readonly sourceKey: string;
  readonly action: DeliveryAction;
  readonly createdAt: Date;
}

export interface CreatorRecord {
  readonly id: CreatorId;
  readonly displayName: string;
  readonly timezone: string;
}

export interface BotsStore {
  listBots(): Promise<readonly BotRecord[]>;
  findBot(id: TelegramBotId): Promise<BotRecord | null>;
  findBotByTelegramId(telegramBotId: string): Promise<BotRecord | null>;
  insertBot(
    bot: Omit<BotRecord, 'updatesOffset' | 'lastPolledAt'> & { readonly token: string },
  ): Promise<void>;
  replaceToken(id: TelegramBotId, token: string, username: string, displayName: string): Promise<void>;
  /** The bot's state and the last poll error (`last_poll_error`). */
  setBotState(id: TelegramBotId, state: TelegramBotState, error: TelegramErrorKind | null): Promise<void>;
  /**
   * After a successful poll, in one transaction: the next offset, the groups seen, renamed or moved to a
   * supergroup, and the bot back to `active`.
   */
  applyUpdates(id: TelegramBotId, batch: UpdatesBatch, polledAt: Date): Promise<void>;
  removeBot(id: TelegramBotId): Promise<void>;

  listChats(): Promise<readonly ChatRecord[]>;
  findChat(id: TelegramChatId): Promise<ChatRecord | null>;
  updateChat(
    id: TelegramChatId,
    patch: Partial<
      Pick<
        ChatRecord,
        'nextSendAt' | 'lastSentAt' | 'lastErrorKind' | 'membership' | 'canPost' | 'telegramChatId'
      >
    > & {
      readonly lastErrorAt?: Date | null;
    },
  ): Promise<void>;

  /**
   * REG-28, in one transaction: deletes the group and its routes (cascade) if `mayRemove` says so of its membership
   * read under a row lock. Its deliveries stay, without a group and with its title (the night counts read them): those
   * still pending fail, those being sent turn `unknown`, both `chat_removed`. Moves the routing version so open
   * screens reload; writes `audit_log`.
   */
  removeChat(
    id: TelegramChatId,
    mayRemove: (membership: TelegramMembership) => boolean,
    userId: string,
  ): Promise<'removed' | 'missing' | 'refused'>;

  listRoutes(): Promise<{ readonly routes: readonly TelegramRoute[]; readonly version: number }>;
  /** Replaces the whole table if it is still at `version`; false otherwise. */
  replaceRoutes(version: number, routes: readonly TelegramRoute[]): Promise<boolean>;

  /** The creators not archived (ADR 0071 § 2), oldest first. */
  listCreators(): Promise<readonly CreatorRecord[]>;
  /** The display name of a CRM user, for « Pris en main par … ». */
  userName(userId: string): Promise<string | null>;
  /** The sales topic's settings (CRM-04 lot b), a row it cannot read left out (the defaults then apply). */
  listSaleSettings(): Promise<readonly TelegramSaleSettingsEntry[]>;
  /** Replaces the whole list, with an `audit_log` row by `userId`. */
  replaceSaleSettings(entries: readonly TelegramSaleSettingsEntry[], userId: string): Promise<void>;
  /** The name the team shows for a member, for « vendue par … » (CRM-04 lot b); null for an unknown id. */
  memberName(memberId: string): Promise<string | null>;
}

/**
 * One creator's sales totals of a day (CRM-04 lot b): `salesFeedTotals.totalsOf` of `connectors`, given by the
 * composition root. The day is the sale's in the platform's zone, the rule every reader of the totals shares.
 */
/**
 * The dollar rate of a sale (ADR 0033, `exchange_rates`): the newest of its day or before, the day read in the
 * agency's zone, in euros per million dollars; `null` when there is none.
 */
export interface UsdRateReader {
  onDayOf(occurredAt: Date): Promise<number | null>;
}

/**
 * What the evening digest reads of a creator's day in `connectors`, in one transaction (CRM-04): the totals (each line
 * on its sale's day), the refunds made that day (each on its own day, its sale's day said), and how far each register
 * where one of her accounts is linked was read (ADR 0054). No reading: no register linked.
 */
export interface SalesDay {
  readonly totals: SalesTotals;
  readonly refunds: SalesRefunds;
  readonly readings: readonly SalesFeedReading[];
}

export interface SalesDayReader {
  dayOf(creatorId: CreatorId, day: string): Promise<SalesDay>;
}

interface ScanBatch {
  readonly deliveries: readonly NewDelivery[];
  /** Where the scan got to: the `created_at` of the last event read. */
  readonly cursor: Date;
}

export interface DeliveriesStore {
  getCursor(): Promise<Date>;
  /**
   * Consumed events created after `since`, oldest first, and the `created_at` of the last row read, readable or not:
   * a run of rows the module cannot read still moves the cursor past them, never blocks the scan behind them.
   */
  readEvents(
    since: Date,
    limit: number,
  ): Promise<{ readonly events: readonly ScannedEvent[]; readonly lastReadAt: Date | null }>;
  /** The sent or pending root messages of a thread, one per group. */
  threadRoots(threadKey: string): Promise<readonly ThreadRoot[]>;
  /** The latest delivery of a thread, every group and action together (P3-12's reminder); null when it has none. */
  latestOfThread(threadKey: string): Promise<LatestOfThread | null>;
  /** Inserts (a replayed source adds nothing), moves the cursor and enqueues each touched group, in one transaction. */
  applyScan(batch: ScanBatch): Promise<void>;
  /** Inserts and enqueues one delivery outside a scan (test message, digest). False if its source was already there. */
  insertDelivery(delivery: NewDelivery, now: Date): Promise<boolean>;

  /** Deliveries of a group ready to go (`run_after` passed), most serious first. */
  readyFor(chatId: TelegramChatId, now: Date): Promise<readonly DeliveryRecord[]>;
  /** Deliveries left `sending` before `olderThan`: interrupted calls. */
  staleSending(chatId: TelegramChatId, olderThan: Date): Promise<readonly DeliveryRecord[]>;
  /** Counts one more attempt. */
  markSending(ids: readonly string[]): Promise<void>;
  markSent(ids: readonly string[], telegramMessageId: number | null, sentAt: Date): Promise<void>;
  /** Back to `pending`, not before `runAfter`. */
  markRetry(ids: readonly string[], runAfter: Date, errorKind: TelegramErrorKind | null): Promise<void>;
  markDone(
    ids: readonly string[],
    status: 'failed' | 'unknown',
    errorKind: TelegramErrorKind | null,
  ): Promise<void>;
  /** Puts interrupted urgent deliveries back in the queue, with the resend mark in their text. */
  requeue(ids: readonly string[], text: (old: string) => string, runAfter: Date): Promise<void>;
  /** Where the message a closure acts on stands, and the id Telegram gave it once sent. */
  parentState(deliveryId: string): Promise<{
    readonly status: TelegramDeliveryStatus;
    readonly telegramMessageId: number | null;
    /** The message also carried other deliveries (a grouped send): rewriting it would drop them. */
    readonly isShared: boolean;
  } | null>;
  /** The earliest `run_after` of the group's pending deliveries, to schedule the next flush. */
  nextRunAfter(chatId: TelegramChatId): Promise<Date | null>;
  setClosedBy(deliveryId: string, name: string): Promise<void>;

  enqueueFlush(chatId: TelegramChatId, runAt: Date): Promise<void>;
  enqueuePoll(botId: TelegramBotId, waitSeconds: number): Promise<void>;

  listDeliveries(limit: number, topic: TelegramTopic | null): Promise<readonly LoggedDelivery[]>;
  countTopics(creatorId: CreatorId, from: Date, to: Date): Promise<Partial<Record<TelegramTopic, number>>>;
  purgeBefore(at: Date): Promise<number>;
}

/** What one `getUpdates` brought, already reduced to the facts the module keeps. */
export interface UpdatesBatch {
  readonly nextOffset: number;
  readonly chats: readonly {
    readonly telegramChatId: string;
    readonly title: string;
    readonly kind: TelegramChatKind;
    readonly membership: TelegramMembership;
    readonly canPost: boolean;
  }[];
  readonly migrations: readonly { readonly fromChatId: string; readonly toChatId: string }[];
  /** A group renamed: only the title of a group already known changes. */
  readonly titles: readonly { readonly telegramChatId: string; readonly title: string }[];
  /** `/start <code>` in private chats, in order (ADR 0068 § 4); applied apart, before the offset moves. */
  readonly starts: readonly { readonly telegramChatId: string; readonly code: string }[];
}

/** An account's private chat with a bot (ADR 0068 § 4), for its reset link alone. */
interface PrivateLink {
  readonly botId: TelegramBotId;
  readonly telegramChatId: string;
  readonly linkedAt: Date;
}

/** The private links and their one-time codes, as the admin role (ADR 0068 § 4); each change writes `audit_log`. */
export interface PrivateLinksStore {
  /** Replaces the account's pending code by this one (its SHA-256 alone), valid until `expiresAt`. */
  issueCode(userId: string, codeHash: string, expiresAt: Date): Promise<void>;
  /**
   * In one transaction: takes the code (gone whatever happens next) and, if it was still valid at `now`, links its
   * account to this chat of this bot, replacing an earlier link. The account, or null for a code unknown or expired.
   */
  claimCode(
    codeHash: string,
    botId: TelegramBotId,
    telegramChatId: string,
    now: Date,
  ): Promise<string | null>;
  findLink(userId: string): Promise<PrivateLink | null>;
  /** False when the account had no link. */
  removeLink(userId: string): Promise<boolean>;
}

export type ChannelFailure =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'migrated'; readonly toChatId: string }
  | { readonly kind: 'bad_request' }
  | { readonly kind: 'unreachable' };

export type ChannelResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: ChannelFailure };

/** One update as the channel reduces it; the batch is folded by the application (poll.ts). */
export type ChannelUpdate =
  | {
      readonly kind: 'membership';
      readonly updateId: number;
      readonly telegramChatId: string;
      readonly title: string;
      readonly chatKind: TelegramChatKind | 'private';
      readonly membership: TelegramMembership;
      readonly canPost: boolean;
    }
  | {
      readonly kind: 'migration';
      readonly updateId: number;
      readonly fromChatId: string;
      readonly toChatId: string;
    }
  | {
      readonly kind: 'title';
      readonly updateId: number;
      readonly telegramChatId: string;
      readonly title: string;
    }
  | {
      /** `/start <code>` in a private chat (ADR 0068 § 4): the only message the bot acts on. */
      readonly kind: 'start';
      readonly updateId: number;
      readonly telegramChatId: string;
      readonly code: string;
    }
  | { readonly kind: 'other'; readonly updateId: number };

export interface OutgoingMessage {
  readonly text: string;
  readonly isSilent: boolean;
  readonly replyToMessageId: number | null;
}

/** The notification channel (ADR 0020 §1). Never logs a URL or a raw error: the token sits in the URL. */
export interface NotificationChannel {
  getMe(
    token: string,
  ): Promise<
    ChannelResult<{ readonly telegramBotId: string; readonly username: string; readonly displayName: string }>
  >;
  deleteWebhook(token: string): Promise<ChannelResult<null>>;
  getUpdates(
    token: string,
    offset: number,
    waitSeconds: number,
  ): Promise<ChannelResult<readonly ChannelUpdate[]>>;
  send(
    token: string,
    telegramChatId: string,
    message: OutgoingMessage,
  ): Promise<ChannelResult<{ readonly messageId: number }>>;
  edit(token: string, telegramChatId: string, messageId: number, text: string): Promise<ChannelResult<null>>;
}

export interface Clock {
  now(): Date;
}

/** Her alerts' names by the id of their row, archived ones too (the `alerts` module, wired by the composition root). */
export interface AlertNames {
  ofCreator(creatorId: CreatorId): Promise<ReadonlyMap<string, string>>;
}

/** The creator's channel as stored (ADR 0080): her setting, whole; the channel column is the setting's own. */
export interface ChannelRecord {
  readonly creatorId: CreatorId;
  /** The `chat_id` column: it, not the setting, says which chat she holds (a removed chat empties it). */
  readonly chatId: TelegramChatId | null;
  /** Null when the stored setting no longer reads: her chat still counts as hers. */
  readonly config: TelegramChannelConfig | null;
  readonly archived: boolean;
}

/** The creators' channels, as the admin role; each save writes `audit_log`. */
export interface ChannelsStore {
  /** Null when the owner never saved one for her; a row it cannot read reads as never saved. */
  findChannel(creatorId: CreatorId): Promise<ChannelRecord | null>;
  listChannels(): Promise<readonly ChannelRecord[]>;
  /** Whether she exists and is not archived. */
  creatorActive(creatorId: CreatorId): Promise<boolean>;
  /** `chat_taken` when another creator holds that channel (the unique key decides, two saves at once included). */
  saveChannel(
    creatorId: CreatorId,
    config: TelegramChannelConfig,
    userId: string,
  ): Promise<'saved' | 'chat_taken'>;
}

/**
 * ADR 0080 § 5: who she is for the post, from her active persona version, and her guards on the words of a post (the
 * agent's, plus nothing explicit on a public channel). Wired from the `agent` module, matched by shape.
 */
export interface ChannelWriterPersona {
  /** Her version, as the playground names it (« 2.0.0 »). */
  readonly version: string;
  readonly creatorName: string;
  readonly personaSheet: string;
  check(texts: readonly string[]): readonly ChannelPostViolation[];
}
/** Null when she has no active version: nothing is written for her. */
export type ChannelPersonaSource = (creatorId: CreatorId) => Promise<ChannelWriterPersona | null>;

export interface ChannelVoiceInput {
  readonly creatorId: CreatorId;
  readonly kind: ChannelPostKind;
  readonly creatorName: string;
  readonly personaSheet: string;
  readonly examples: readonly string[];
  readonly media: string | null;
  readonly destination: string | null;
  readonly advice: string | null;
}
export type ChannelVoiceOutput =
  | { readonly kind: 'post'; readonly text: string }
  | { readonly kind: 'poll'; readonly question: string; readonly options: readonly string[] };
/** The voice of the gateway (role `voice`, prompt `voice/telegram-channel`); null when no model answered. */
export type ChannelVoice = (input: ChannelVoiceInput) => Promise<ChannelVoiceOutput | null>;
