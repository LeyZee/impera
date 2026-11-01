import type {
  CreatorId,
  TelegramBotId,
  TelegramBotState,
  TelegramChatId,
  TelegramChatKind,
  TelegramDeliveryStatus,
  TelegramErrorKind,
  TelegramMembership,
  TelegramRoute,
  TelegramTopic,
} from '@nirvana/contracts';

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

  listCreators(): Promise<readonly CreatorRecord[]>;
  /** The display name of a CRM user, for « Pris en main par … ». */
  userName(userId: string): Promise<string | null>;
}

interface ScanBatch {
  readonly deliveries: readonly NewDelivery[];
  /** Where the scan got to: the `created_at` of the last event read. */
  readonly cursor: Date;
}

export interface DeliveriesStore {
  getCursor(): Promise<Date>;
  /** Consumed events created after `since`, oldest first. */
  readEvents(since: Date, limit: number): Promise<readonly ScannedEvent[]>;
  /** The sent or pending root messages of a thread, one per group. */
  threadRoots(threadKey: string): Promise<readonly ThreadRoot[]>;
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
