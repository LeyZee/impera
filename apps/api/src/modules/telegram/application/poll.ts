import type { TelegramBotId, TelegramChatKind } from '@impera/contracts';

import type {
  BotsStore,
  ChannelUpdate,
  Clock,
  DeliveriesStore,
  NotificationChannel,
  PrivateLinksStore,
  UpdatesBatch,
} from '../domain/ports';

import { applyStart } from './private-link';

export interface PollDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly channel: NotificationChannel;
  readonly clock: Clock;
  /** ADR 0068 § 4: without it, a `/start <code>` is read past like any other message. */
  readonly privateLinks?: PrivateLinksStore;
}

/** The long poll while the screen waits for the bot to enter a group (ADR 0020 §6). */
export const LISTEN_SECONDS = 20;

/**
 * `telegram.poll_updates`, in the serial queue of the bot: one reader per token, so our own jobs never cut each
 * other off (409). Reads membership facts; the one message it acts on is `/start <code>` in private (ADR 0068 § 4, ADR 0020 §13).
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
  const batch = foldUpdates(bot.updatesOffset, result.value);
  // Before the offset moves: a crash in between reads the code again, already taken, rather than losing the link.
  if (deps.privateLinks !== undefined) {
    const links = { ...deps, privateLinks: deps.privateLinks };
    const token = bot.token;
    for (const start of batch.starts) await applyStart(links, { ...bot, token }, start);
  }
  await deps.bots.applyUpdates(bot.id, batch, deps.clock.now());
}

/** Folds a batch, in order: the latest fact about a group wins. Private chats are not groups and are dropped. */
export function foldUpdates(offset: number, updates: readonly ChannelUpdate[]): UpdatesBatch {
  let nextOffset = offset;
  const chats = new Map<string, UpdatesBatch['chats'][number]>();
  const migrations: { fromChatId: string; toChatId: string }[] = [];
  const titles = new Map<string, string>();
  const starts: { telegramChatId: string; code: string }[] = [];
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
      case 'start':
        starts.push({ telegramChatId: update.telegramChatId, code: update.code });
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
    starts,
  };
}

/** `telegram.dispatch_polls`, every minute: one short poll per usable bot. A bot « utilisé ailleurs » is still read, to see it come back. */
export async function dispatchPolls(deps: Pick<PollDeps, 'bots' | 'deliveries'>): Promise<number> {
  const bots = await deps.bots.listBots();
  const usable = bots.filter((bot) => bot.token !== null && bot.state !== 'refused');
  for (const bot of usable) await deps.deliveries.enqueuePoll(bot.id, 0);
  return usable.length;
}
