import type {
  ChannelPostKind,
  ChannelPostViolation,
  CreatorId,
  TelegramBotId,
  TelegramBotState,
  TelegramChannelConfig,
  TelegramChatId,
  TelegramChatKind,
  TelegramErrorKind,
  TelegramMembership,
  RedirectLink,
} from '@impera/contracts';

/** Ports of the module (ADR 0020, ADR 0080). The Postgres store seals tokens with CREDENTIALS_ENCRYPTION_KEYS. */

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
   * REG-28, in one transaction: deletes the chat if `mayRemove` says so of its membership read under a row lock;
   * writes `audit_log`.
   */
  removeChat(
    id: TelegramChatId,
    mayRemove: (membership: TelegramMembership) => boolean,
    userId: string,
  ): Promise<'removed' | 'missing' | 'refused'>;

  /** `telegram.poll_updates` for the bot, in its serial queue; `waitSeconds` > 0 is a long poll (step 3). */
  enqueuePoll(botId: TelegramBotId, waitSeconds: number): Promise<void>;
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
  /** A channel renamed: only the title of a chat already known changes. */
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

/**
 * The Bot API as the creators' channels need it (ADR 0080). Never logs a URL or a raw error: the token sits in the URL.
 */
export interface BotChannel {
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
/**
 * Her redirect links that are on, kept by the `redirect-links` module since INS-03 (ADR 0121 § 1), matched by shape.
 * Null when that module holds no link of hers: the links of the channel's own setting are read, for one version.
 */
export type ChannelLinksSource = (creatorId: CreatorId) => Promise<readonly RedirectLink[] | null>;

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
interface ChannelWriterPersona {
  /** Her version, as the playground names it (« 2.0.0 »). */
  readonly version: string;
  readonly creatorName: string;
  readonly personaSheet: string;
  check(texts: readonly string[]): readonly ChannelPostViolation[];
}
/** Null when she has no active version: nothing is written for her. */
export type ChannelPersonaSource = (creatorId: CreatorId) => Promise<ChannelWriterPersona | null>;

interface ChannelVoiceInput {
  readonly creatorId: CreatorId;
  readonly kind: ChannelPostKind;
  readonly creatorName: string;
  readonly personaSheet: string;
  readonly examples: readonly string[];
  readonly media: string | null;
  readonly destination: string | null;
  readonly advice: string | null;
}
type ChannelVoiceOutput =
  | { readonly kind: 'post'; readonly text: string }
  | { readonly kind: 'poll'; readonly question: string; readonly options: readonly string[] };
/** The voice of the gateway (role `voice`, prompt `voice/telegram-channel`); null when no model answered. */
export type ChannelVoice = (input: ChannelVoiceInput) => Promise<ChannelVoiceOutput | null>;
