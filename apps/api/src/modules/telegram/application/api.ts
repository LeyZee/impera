import type {
  CreatorId,
  Result,
  TelegramBot,
  TelegramBotId,
  TelegramChatId,
  TelegramDelivery,
  TelegramNightCounts,
  TelegramOverview,
  TelegramRefusal,
  TelegramRoute,
  TelegramTopic,
} from '@nirvana/contracts';

/** What the routes and other modules (the Dashboard) use; the jobs are separate (index.ts). */
export interface TelegramApi {
  overview(): Promise<TelegramOverview>;
  addBot(token: string): Promise<Result<TelegramBot, TelegramRefusal>>;
  /** Null when the bot does not exist. */
  replaceToken(id: TelegramBotId, token: string): Promise<Result<TelegramBot, TelegramRefusal> | null>;
  removeBot(id: TelegramBotId): Promise<boolean>;
  listen(id: TelegramBotId): Promise<boolean>;
  /** REG-28: `refused` while the bot still sits in the group. */
  removeChat(id: TelegramChatId, userId: string): Promise<'removed' | 'missing' | 'refused'>;
  saveRoutes(
    version: number,
    routes: readonly TelegramRoute[],
  ): Promise<Result<{ routes: TelegramRoute[]; version: number }, TelegramRefusal | 'unknown_chat'>>;
  sendTest(chatId: TelegramChatId): Promise<Result<{ sentAt: string }, TelegramRefusal> | null>;
  listDeliveries(topic: TelegramTopic | null, limit: number): Promise<TelegramDelivery[]>;
  nightCounts(creatorId: CreatorId): Promise<TelegramNightCounts>;
}
