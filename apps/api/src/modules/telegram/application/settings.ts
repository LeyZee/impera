import {
  err,
  newId,
  ok,
  TelegramBotIdSchema,
  type CreatorId,
  type Result,
  type TelegramBot,
  type TelegramBotId,
  type TelegramChatId,
  type TelegramDelivery,
  type TelegramErrorKind,
  type TelegramNightCounts,
  type TelegramOverview,
  type TelegramRefusal,
  type TelegramRoute,
  type TelegramTopic,
} from '@nirvana/contracts';

import { computeCoverage } from '../domain/coverage';
import { mayRemoveChat } from '../domain/membership';
import { describeTelegramError } from '../domain/messages';
import type {
  BotRecord,
  BotsStore,
  ChannelFailure,
  ChatRecord,
  Clock,
  DeliveriesStore,
  NotificationChannel,
} from '../domain/ports';
import { renderPlain } from '../domain/render';
import { DELIVERY_RETENTION_MS, morningDigestKey, nightOf } from '../domain/schedule';
import { botIdOfToken } from '../domain/token';

import { LISTEN_SECONDS } from './poll';

export interface SettingsDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly channel: NotificationChannel;
  readonly clock: Clock;
}

function refusal(kind: TelegramErrorKind): TelegramRefusal {
  return { kind, message: describeTelegramError(kind) };
}

/** What a failed `getMe` means for a pasted token. */
function tokenRefusal(failure: ChannelFailure): TelegramRefusal {
  return refusal(
    failure.kind === 'unauthorized' || failure.kind === 'bad_request' ? 'token_refused' : 'unreachable',
  );
}

function toChat(chat: ChatRecord): TelegramBot['chats'][number] {
  return {
    id: chat.id,
    title: chat.title,
    kind: chat.kind,
    membership: chat.membership,
    canPost: chat.canPost,
    lastSentAt: chat.lastSentAt?.toISOString() ?? null,
    lastError: chat.lastErrorKind === null ? null : describeTelegramError(chat.lastErrorKind),
  };
}

function toBot(bot: BotRecord, chats: readonly ChatRecord[]): TelegramBot {
  return {
    id: bot.id,
    username: bot.username,
    displayName: bot.displayName,
    // A token that no longer decrypts reads as one to replace.
    state: bot.token === null ? 'refused' : bot.state,
    lastPolledAt: bot.lastPolledAt?.toISOString() ?? null,
    // A group the bot left or was banned from stays listed, as « retiré », until the owner removes it (REG-28).
    chats: chats.filter((chat) => chat.botId === bot.id).map(toChat),
  };
}

export async function overview(deps: SettingsDeps): Promise<TelegramOverview> {
  const [bots, chats, { routes, version }, creators] = await Promise.all([
    deps.bots.listBots(),
    deps.bots.listChats(),
    deps.bots.listRoutes(),
    deps.bots.listCreators(),
  ]);
  const usableBots = new Set(
    bots.filter((bot) => bot.token !== null && bot.state !== 'refused').map((bot) => bot.id),
  );
  return {
    bots: bots.map((bot) => toBot(bot, chats)),
    routes: [...routes],
    coverage: computeCoverage(
      creators,
      routes,
      chats.map((chat) => ({
        id: chat.id,
        reachable: chat.membership === 'member' && chat.canPost && usableBots.has(chat.botId),
      })),
    ),
    version,
  };
}

async function botView(deps: SettingsDeps, id: TelegramBotId): Promise<TelegramBot | null> {
  const [bot, chats] = await Promise.all([deps.bots.findBot(id), deps.bots.listChats()]);
  return bot === null ? null : toBot(bot, chats);
}

/** Step 2 of the sheet: checks the token with Telegram, takes the bot off any webhook, keeps it sealed. */
export async function addBot(
  deps: SettingsDeps,
  token: string,
): Promise<Result<TelegramBot, TelegramRefusal>> {
  const telegramBotId = botIdOfToken(token);
  if (telegramBotId === null) return err(refusal('token_shape'));
  if ((await deps.bots.findBotByTelegramId(telegramBotId)) !== null) return err(refusal('bot_exists'));
  const clean = token.trim();
  const me = await deps.channel.getMe(clean);
  if (!me.ok) return err(tokenRefusal(me.failure));
  const unhooked = await deps.channel.deleteWebhook(clean);
  if (!unhooked.ok) return err(tokenRefusal(unhooked.failure));
  const id = newId(TelegramBotIdSchema);
  await deps.bots.insertBot({
    id,
    telegramBotId: me.value.telegramBotId,
    username: me.value.username,
    displayName: me.value.displayName,
    token: clean,
    state: 'active',
  });
  await deps.deliveries.enqueuePoll(id, 0);
  const view = await botView(deps, id);
  return view === null ? err(refusal('unreachable')) : ok(view);
}

/** « Remplacer le jeton » after a /revoke: same bot only, its groups and routes kept. */
export async function replaceToken(
  deps: SettingsDeps,
  id: TelegramBotId,
  token: string,
): Promise<Result<TelegramBot, TelegramRefusal> | null> {
  const bot = await deps.bots.findBot(id);
  if (bot === null) return null;
  const telegramBotId = botIdOfToken(token);
  if (telegramBotId === null) return err(refusal('token_shape'));
  if (telegramBotId !== bot.telegramBotId) return err(refusal('bot_mismatch'));
  const clean = token.trim();
  const me = await deps.channel.getMe(clean);
  if (!me.ok) return err(tokenRefusal(me.failure));
  const unhooked = await deps.channel.deleteWebhook(clean);
  if (!unhooked.ok) return err(tokenRefusal(unhooked.failure));
  await deps.bots.replaceToken(id, clean, me.value.username, me.value.displayName);
  await deps.deliveries.enqueuePoll(id, 0);
  const view = await botView(deps, id);
  return view === null ? null : ok(view);
}

export async function removeBot(deps: SettingsDeps, id: TelegramBotId): Promise<boolean> {
  if ((await deps.bots.findBot(id)) === null) return false;
  await deps.bots.removeBot(id);
  return true;
}

/** « Retirer de la liste » (REG-28): a group the bot left or was banned from, with its routes. */
export function removeChat(
  deps: SettingsDeps,
  id: TelegramChatId,
  userId: string,
): Promise<'removed' | 'missing' | 'refused'> {
  return deps.bots.removeChat(id, mayRemoveChat, userId);
}

/** Step 3: the screen waits for the bot to enter a group; a long poll answers as soon as it does. */
export async function listen(deps: SettingsDeps, id: TelegramBotId): Promise<boolean> {
  if ((await deps.bots.findBot(id)) === null) return false;
  await deps.deliveries.enqueuePoll(id, LISTEN_SECONDS);
  return true;
}

export async function saveRoutes(
  deps: SettingsDeps,
  version: number,
  routes: readonly TelegramRoute[],
): Promise<Result<{ routes: TelegramRoute[]; version: number }, TelegramRefusal | 'unknown_chat'>> {
  const chats = new Set((await deps.bots.listChats()).map((chat) => chat.id));
  if (routes.some((route) => !chats.has(route.chatId))) return err('unknown_chat');
  const unique = new Map(
    routes.map((route) => [`${route.creatorId ?? '*'}|${route.topic}|${route.chatId}`, route]),
  );
  if (!(await deps.bots.replaceRoutes(version, [...unique.values()])))
    return err(refusal('routes_version_conflict'));
  const saved = await deps.bots.listRoutes();
  return ok({ routes: [...saved.routes], version: saved.version });
}

const TEST_TEXT = '✅ <b>Test Nirvana</b>\nCe groupe reçoit bien les notifications.';

/** « Envoyer un test »: sent now, outside the queue, so the screen knows at once. */
export async function sendTest(
  deps: SettingsDeps,
  chatId: TelegramChatId,
): Promise<Result<{ sentAt: string }, TelegramRefusal> | null> {
  const chat = await deps.bots.findChat(chatId);
  if (chat === null) return null;
  const bot = await deps.bots.findBot(chat.botId);
  if (bot?.token == null) return err(refusal('token_refused'));
  const result = await deps.channel.send(bot.token, chat.telegramChatId, {
    text: TEST_TEXT,
    isSilent: false,
    replyToMessageId: null,
  });
  const now = deps.clock.now();
  if (result.ok) {
    await deps.bots.updateChat(chat.id, { lastSentAt: now, lastErrorKind: null, lastErrorAt: null });
    return ok({ sentAt: now.toISOString() });
  }
  switch (result.failure.kind) {
    case 'forbidden':
      await deps.bots.updateChat(chat.id, {
        membership: 'left',
        canPost: false,
        lastErrorKind: 'chat_unreachable',
        lastErrorAt: now,
      });
      return err(refusal('chat_unreachable'));
    case 'unauthorized':
      await deps.bots.setBotState(bot.id, 'refused', 'token_refused');
      return err(refusal('token_refused'));
    case 'rate_limited':
      return err(refusal('rate_limited'));
    case 'migrated':
      await deps.bots.updateChat(chat.id, { telegramChatId: result.failure.toChatId });
      return sendTest(deps, chatId);
    case 'bad_request':
    case 'conflict':
    case 'unreachable':
      return err(refusal('unreachable'));
  }
}

export async function listDeliveries(
  deps: SettingsDeps,
  topic: TelegramTopic | null,
  limit: number,
): Promise<TelegramDelivery[]> {
  const rows = await deps.deliveries.listDeliveries(limit, topic);
  return rows
    .filter((row) => row.action === 'send')
    .map((row) => ({
      id: row.id,
      topic: row.topic,
      creatorId: row.creatorId,
      chatTitle: row.chatTitle,
      summary: row.summary,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      closedBy: row.closedBy,
    }));
}

/** For the Dashboard's guards card (P3-07): the alerts of the current night, or of the last one during the day. */
export async function nightCounts(
  deps: Pick<SettingsDeps, 'bots' | 'deliveries' | 'clock'>,
  creatorId: CreatorId,
): Promise<TelegramNightCounts> {
  const creator = (await deps.bots.listCreators()).find((row) => row.id === creatorId);
  const { from, to } = nightOf(creator?.timezone ?? 'Europe/Paris', deps.clock.now());
  const counts = await deps.deliveries.countTopics(creatorId, from, to);
  return { urgent: counts.urgent ?? 0, important: counts.important ?? 0, info: counts.info ?? 0 };
}

/**
 * `telegram.morning_digest`, hourly: in each creator's 8 o'clock hour, one silent line per group that gets her info
 * topic, with last night's counts. The key of the day makes it once, whatever the cron does.
 */
export async function morningDigest(
  deps: Pick<SettingsDeps, 'bots' | 'deliveries' | 'clock'>,
): Promise<number> {
  const now = deps.clock.now();
  const [creators, { routes }, chats] = await Promise.all([
    deps.bots.listCreators(),
    deps.bots.listRoutes(),
    deps.bots.listChats(),
  ]);
  const reachable = new Set(
    chats.filter((chat) => chat.membership === 'member' && chat.canPost).map((chat) => chat.id),
  );
  let sent = 0;
  for (const creator of creators) {
    const key = morningDigestKey(creator.id, creator.timezone, now);
    if (key === null) continue;
    const counts = await nightCounts(deps, creator.id);
    const line =
      counts.urgent + counts.important === 0
        ? 'Nuit calme : aucune alerte.'
        : `Cette nuit : ${String(counts.urgent)} urgente${counts.urgent > 1 ? 's' : ''}, ${String(counts.important)} importante${counts.important > 1 ? 's' : ''}.`;
    const text = `🔵 <b>Bilan du matin · ${renderPlain(creator.displayName)}</b>\n${renderPlain(line)}`;
    const targets = new Set(
      routes
        .filter(
          (route) => route.topic === 'info' && (route.creatorId === null || route.creatorId === creator.id),
        )
        .map((route) => route.chatId)
        .filter((id) => reachable.has(id)),
    );
    for (const chatId of targets) {
      const added = await deps.deliveries.insertDelivery(
        {
          sourceKey: key,
          chatId,
          creatorId: creator.id,
          topic: 'info',
          action: 'send',
          parentId: null,
          threadKey: null,
          text,
          summary: line,
          isSilent: true,
          closedBy: null,
        },
        now,
      );
      if (added) sent += 1;
    }
  }
  return sent;
}

/** `telegram.purge`, daily: deliveries older than 30 days go (ADR 0020, conséquences). */
export async function purge(deps: Pick<SettingsDeps, 'deliveries' | 'clock'>): Promise<number> {
  return deps.deliveries.purgeBefore(new Date(deps.clock.now().getTime() - DELIVERY_RETENTION_MS));
}
