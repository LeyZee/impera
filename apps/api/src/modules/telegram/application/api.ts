import type {
  ChannelRefusal,
  ChannelTryRefusalKind,
  CreatorId,
  Result,
  TelegramBot,
  TelegramBotId,
  TelegramChannelConfig,
  TelegramChannelView,
  TelegramChatId,
  TelegramOverview,
  TelegramRefusal,
  TriedChannelPost,
  TryChannelPostBody,
} from '@impera/contracts';

/** What the routes use; the jobs are separate (index.ts). */
export interface TelegramApi {
  overview(): Promise<TelegramOverview>;
  addBot(token: string): Promise<Result<TelegramBot, TelegramRefusal>>;
  /** Null when the bot does not exist. */
  replaceToken(id: TelegramBotId, token: string): Promise<Result<TelegramBot, TelegramRefusal> | null>;
  removeBot(id: TelegramBotId): Promise<boolean>;
  listen(id: TelegramBotId): Promise<boolean>;
  /** REG-28: `refused` while the bot still sits in the group. */
  removeChat(id: TelegramChatId, userId: string): Promise<'removed' | 'missing' | 'refused'>;
  /** Her Telegram channel (ADR 0080); null when she does not exist or is archived. */
  channel(creatorId: CreatorId): Promise<TelegramChannelView | null>;
  saveChannel(
    creatorId: CreatorId,
    config: TelegramChannelConfig,
    userId: string,
  ): Promise<Result<TelegramChannelView, ChannelRefusal> | null>;
  /**
   * A post of her channel written as production will, never sent (ADR 0080 § 7, « Post du canal »); null when she
   * does not exist or is archived.
   */
  tryChannelPost(
    creatorId: CreatorId,
    body: TryChannelPostBody,
  ): Promise<Result<TriedChannelPost, ChannelTryRefusalKind> | null>;
}
