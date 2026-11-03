import type { TelegramBotId, TelegramChatKind } from '@impera/contracts';

import type {
  BotsStore,
  ChannelUpdate,
  Clock,
  DeliveriesStore,
  NotificationChannel,
  UpdatesBatch,
} from '../domain/ports';

export interface PollDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly channel: NotificationChannel;
  readonly clock: Clock;
}

/** The long poll while the screen waits for the bot to enter a group (ADR 0020 §6). */
export const LISTEN_SECONDS = 20;

/**
 * `telegram.poll_updates`, in the serial queue of the bot: one reader per token, so our own jobs never cut each
 * other off (409). Reads only membership facts: the bot never acts on a message (ADR 0020 §13).
 */
export async function pollBot(deps: PollDeps, botId: TelegramBotId, waitSeconds: number): Promise<void> {
  const bot = await deps.bots.findBot(botId);
  if (bot?.token == null || bot.state === 'refused') return;
  const result = await deps.channel.getUpdates(bot.token, bot.updatesOffset, waitSeconds);
  if (!result.ok) {
    switch (result.failure.kind) {
      case 'unauthorized':
        await deps.bots.setBotState(bot.id, 'refused', 'token_refused');
        return;
      case 'conflict':
        await deps.bots.setBotState(bot.id, 'conflict', 'bot_conflict');
        return;
      case 'bad_request':
      case 'forbidden':
      case 'migrated':
      case 'rate_limited':
      case 'unreachable':
        await deps.bots.setBotState(bot.id, bot.state, 'unreachable');
        return;
    }
  }
  await deps.bots.applyUpdates(bot.id, foldUpdates(bot.updatesOffset, result.value), deps.clock.now());
}

/** Folds a batch, in order: the latest fact about a group wins. Private chats are not groups and are dropped. */
export function foldUpdates(offset: number, updates: readonly ChannelUpdate[]): UpdatesBatch {
  let nextOffset = offset;
  const chats = new Map<string, UpdatesBatch['chats'][number]>();
  const migrations: { fromChatId: string; toChatId: string }[] = [];
  const titles = new Map<string, string>();
  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.updateId + 1);
    switch (update.kind) {
      case 'membership':
        if (update.chatKind === 'private') break;
        chats.set(update.telegramChatId, {
          telegramChatId: update.telegramChatId,
          title: update.title,
          kind: update.chatKind satisfies TelegramChatKind,
          membership: update.membership,
          canPost: update.canPost,
        });
        break;
      case 'migration':
        migrations.push({ fromChatId: update.fromChatId, toChatId: update.toChatId });
        break;
      case 'title':
        titles.set(update.telegramChatId, update.title);
        break;
      case 'other':
        break;
    }
  }
  return {
    nextOffset,
    chats: [...chats.values()],
    migrations,
    titles: [...titles].map(([telegramChatId, title]) => ({ telegramChatId, title })),
  };
}

/** `telegram.dispatch_polls`, every minute: one short poll per usable bot. A bot « utilisé ailleurs » is still read, to see it come back. */
export async function dispatchPolls(deps: Pick<PollDeps, 'bots' | 'deliveries'>): Promise<number> {
  const bots = await deps.bots.listBots();
  const usable = bots.filter((bot) => bot.token !== null && bot.state !== 'refused');
  for (const bot of usable) await deps.deliveries.enqueuePoll(bot.id, 0);
  return usable.length;
}
