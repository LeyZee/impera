import {
  err,
  newId,
  ok,
  TelegramBotIdSchema,
  type Result,
  type TelegramBot,
  type TelegramBotId,
  type TelegramChatId,
  type TelegramErrorKind,
  type TelegramOverview,
  type TelegramRefusal,
} from '@impera/contracts';

import { mayRemoveChat } from '../domain/membership';
import { describeTelegramError, describeTokenCheckFailure } from '../domain/messages';
import type { BotRecord, BotsStore, BotChannel, ChannelFailure, ChatRecord } from '../domain/ports';
import { botIdOfToken } from '../domain/token';

import { LISTEN_SECONDS } from './poll';

/**
 * Réglages › Telegram, the bots that post in the creators' channels (ADR 0080). Since 27/11/2026, Telegram serves the
 * channels only: no alert group, no routing, no delivery.
 */
export interface SettingsDeps {
  readonly bots: BotsStore;
  readonly channel: BotChannel;
}

function refusal(kind: TelegramErrorKind): TelegramRefusal {
  return { kind, message: describeTelegramError(kind) };
}

/** What a failed `getMe` means for a pasted token: refused, or not checked (nothing kept, nothing retried). */
function tokenRefusal(failure: ChannelFailure): TelegramRefusal {
  return describeTokenCheckFailure(failure.kind);
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
  const [bots, chats] = await Promise.all([deps.bots.listBots(), deps.bots.listChats()]);
  return { bots: bots.map((bot) => toBot(bot, chats)) };
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
  await deps.bots.enqueuePoll(id, 0);
  const view = await botView(deps, id);
  return view === null ? err(refusal('unreachable')) : ok(view);
}

/** « Remplacer le jeton » after a /revoke: same bot only, its channels kept. */
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
  await deps.bots.enqueuePoll(id, 0);
  const view = await botView(deps, id);
  return view === null ? null : ok(view);
}

export async function removeBot(deps: SettingsDeps, id: TelegramBotId): Promise<boolean> {
  if ((await deps.bots.findBot(id)) === null) return false;
  await deps.bots.removeBot(id);
  return true;
}

/** « Retirer de la liste » (REG-28): a channel the bot left or was banned from. */
export function removeChat(
  deps: SettingsDeps,
  id: TelegramChatId,
  userId: string,
): Promise<'removed' | 'missing' | 'refused'> {
  return deps.bots.removeChat(id, mayRemoveChat, userId);
}

/** Step 3: the screen waits for the bot to enter a channel; a long poll answers as soon as it does. */
export async function listen(deps: SettingsDeps, id: TelegramBotId): Promise<boolean> {
  if ((await deps.bots.findBot(id)) === null) return false;
  await deps.bots.enqueuePoll(id, LISTEN_SECONDS);
  return true;
}
