import { createHash, randomInt } from 'node:crypto';

import type { TelegramLinkCode, TelegramPrivateLink } from '@impera/contracts';

import type { BotRecord, BotsStore, Clock, NotificationChannel, PrivateLinksStore } from '../domain/ports';

/**
 * SEC-05 lot 2, ADR 0068 § 4: an account links its private chat with the agency's bot, where its reset link will go
 * if the password is forgotten. The code is shown once in the CRM and kept as its SHA-256 alone; the chat is used
 * for nothing else.
 */

/** ADR 0068 § 4: a code lives ten minutes. */
const LINK_CODE_MINUTES = 10;
/** 32 letters and digits, none mistaken for another (no I, O, 0, 1): ten of them carry 50 bits. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export const LINKED_TEXT =
  'C’est fait : ce chat recevra ton lien si tu oublies ton mot de passe Impera. Rien d’autre n’y passera.';
export const EXPIRED_TEXT =
  'Ce code ne marche plus. Demandes-en un nouveau dans Impera, Réglages › Telegram.';

export interface PrivateLinkDeps {
  readonly bots: BotsStore;
  readonly privateLinks: PrivateLinksStore;
  readonly channel: NotificationChannel;
  readonly clock: Clock;
}

/** The SHA-256 of a code, the only form it is kept or looked up in. Case kept: the bot receives what was sent. */
export const codeHashOf = (code: string): string => createHash('sha256').update(code).digest('hex');

function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () =>
    CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length)),
  ).join('');
}

/** The bot that takes codes: the oldest active one with a readable token. */
async function linkingBot(bots: BotsStore): Promise<BotRecord | null> {
  return (await bots.listBots()).find((bot) => bot.token !== null && bot.state === 'active') ?? null;
}

/** A new code for the account, the last one dropped; null without an active bot to send it to. */
export async function issueLinkCode(deps: PrivateLinkDeps, userId: string): Promise<TelegramLinkCode | null> {
  const bot = await linkingBot(deps.bots);
  if (bot === null) return null;
  const code = newCode();
  const expiresAt = new Date(deps.clock.now().getTime() + LINK_CODE_MINUTES * 60_000);
  await deps.privateLinks.issueCode(userId, codeHashOf(code), expiresAt);
  return {
    code,
    botUsername: bot.username,
    url: `https://t.me/${encodeURIComponent(bot.username)}?start=${code}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function privateLinkOf(deps: PrivateLinkDeps, userId: string): Promise<TelegramPrivateLink> {
  const link = await deps.privateLinks.findLink(userId);
  if (link === null) return { linked: false, botUsername: null, linkedAt: null };
  const bot = await deps.bots.findBot(link.botId);
  return { linked: true, botUsername: bot?.username ?? null, linkedAt: link.linkedAt.toISOString() };
}

/**
 * `/start <code>` read by a bot's poll: the code is taken, the chat linked if it was still valid, and the bot answers
 * in that private chat either way. A failed answer is not retried: the link, when made, stands.
 */
export async function applyStart(
  deps: PrivateLinkDeps,
  bot: BotRecord & { readonly token: string },
  start: { readonly telegramChatId: string; readonly code: string },
): Promise<void> {
  const userId = await deps.privateLinks.claimCode(
    codeHashOf(start.code),
    bot.id,
    start.telegramChatId,
    deps.clock.now(),
  );
  await deps.channel.send(bot.token, start.telegramChatId, {
    text: userId === null ? EXPIRED_TEXT : LINKED_TEXT,
    isSilent: false,
    replyToMessageId: null,
  });
}

/** What the module sends to a linked private chat, and nowhere else (ADR 0068 § 4). */
export type PrivateSendOutcome = 'sent' | 'no_link' | 'failed';

export async function hasPrivateLink(deps: PrivateLinkDeps, userId: string): Promise<boolean> {
  return (await deps.privateLinks.findLink(userId)) !== null;
}

/**
 * Sends a text to the account's private chat, now, once: the reset link (lot 3) is its only use. A bot gone, refused
 * or unreachable is `failed`; the caller says nothing more to the page either way.
 */
export async function sendPrivate(
  deps: PrivateLinkDeps,
  userId: string,
  text: string,
): Promise<PrivateSendOutcome> {
  const link = await deps.privateLinks.findLink(userId);
  if (link === null) return 'no_link';
  const bot = await deps.bots.findBot(link.botId);
  if (bot?.token == null || bot.state === 'refused') return 'failed';
  const sent = await deps.channel.send(bot.token, link.telegramChatId, {
    text,
    isSilent: false,
    replyToMessageId: null,
  });
  return sent.ok ? 'sent' : 'failed';
}
