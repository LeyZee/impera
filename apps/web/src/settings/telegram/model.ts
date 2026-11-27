import type { TelegramBot, TelegramChat } from '@impera/contracts';

/** View rules of Réglages › Bots Telegram, kept out of the components so they are tested. */

export interface ChatChoice {
  readonly chat: TelegramChat;
  readonly bot: TelegramBot;
  /** The bot is accepted by Telegram and may post in the channel. */
  readonly isReachable: boolean;
}

/** Every channel a bot sits in, the reachable ones first. One it left or was banned from is not a choice. */
export function chatChoices(bots: readonly TelegramBot[]): ChatChoice[] {
  return bots
    .flatMap((bot) =>
      bot.chats
        .filter((chat) => chat.membership === 'member')
        .map((chat) => ({ chat, bot, isReachable: chat.canPost && bot.state === 'active' })),
    )
    .sort((a, b) => Number(b.isReachable) - Number(a.isReachable));
}

/** « 1 canal », « 2 canaux »: the plural form when it is not the word with an s. */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${String(count)} ${count > 1 ? many : word}`;
}

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

/** A title that starts with an emoji (« 💰 Ventes ») is drawn by that emoji alone. */
const LEADING_EMOJI = /^\p{Extended_Pictographic}/u;

/** Two letters for the round avatar of a channel, or its leading emoji alone. */
export function initials(title: string): string {
  const first = graphemes.segment(title.trim())[Symbol.iterator]().next().value?.segment ?? '';
  if (LEADING_EMOJI.test(first)) return first;
  const firsts = title
    .split(/\s+/)
    .map((word) => graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? '')
    .filter((first) => first !== '')
    .slice(0, 2);
  return firsts.length === 0 ? '?' : firsts.join('').toLocaleUpperCase('fr');
}

const two = (n: number): string => String(n).padStart(2, '0');

/** « 23 h 12 », in the browser's time zone. */
export function hourLabel(iso: string): string {
  const at = new Date(iso);
  return `${two(at.getHours())} h ${two(at.getMinutes())}`;
}

/** « à 23 h 12 », « hier à 08 h 00 », « le 15/10 ». */
export function whenLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  const dayOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf(now) - dayOf(at)) / 86_400_000);
  if (days <= 0) return `à ${hourLabel(iso)}`;
  if (days === 1) return `hier à ${hourLabel(iso)}`;
  return `le ${two(at.getDate())}/${two(at.getMonth() + 1)}`;
}

const KIND_LABEL: Record<TelegramChat['kind'], string> = {
  group: 'Groupe',
  supergroup: 'Supergroupe',
  channel: 'Canal',
};

/** The second line of a channel: its kind, then why it is broken or when it last got a post. */
export function chatLine(choice: ChatChoice, now: Date): { text: string; isWarning: boolean } {
  const kind = KIND_LABEL[choice.chat.kind];
  if (choice.bot.state !== 'active')
    return { text: `${kind} · rien n’est publié tant que le bot n’est pas réparé`, isWarning: true };
  if (!choice.chat.canPost) return { text: `${kind} · le bot n’a pas le droit d’y publier`, isWarning: true };
  if (choice.chat.lastError !== null) return { text: choice.chat.lastError, isWarning: true };
  if (choice.chat.lastSentAt === null) return { text: `${kind} · rien de publié encore`, isWarning: false };
  return { text: `${kind} · dernier post ${whenLabel(choice.chat.lastSentAt, now)}`, isWarning: false };
}

/** The channels a bot left or was banned from: listed under its channels, to remove (REG-28). */
export function goneChats(bot: TelegramBot): TelegramChat[] {
  return bot.chats.filter((chat) => chat.membership !== 'member');
}

/** The second line of a channel the bot is out of. */
export function goneLine(chat: TelegramChat): string {
  const kind = KIND_LABEL[chat.kind];
  return chat.membership === 'kicked'
    ? `${kind} · le bot a été exclu ici`
    : `${kind} · le bot n’est plus ici`;
}

/** The line under a bot's name: its @identifier, or what is wrong with it. */
export function botLine(bot: TelegramBot): { text: string; isWarning: boolean } {
  switch (bot.state) {
    case 'refused':
      return { text: 'Telegram refuse ce jeton : remplace-le', isWarning: true };
    case 'conflict':
      return { text: 'Un autre programme lit ce bot', isWarning: true };
    case 'active':
      // Its identifier alone: when Impera last asked Telegram for news helps no one (recette du 29/10).
      return { text: `@${bot.username}`, isWarning: false };
  }
}

/**
 * The channels a bot sits in when the sheet starts waiting for a new one. One it left or was banned from is not one
 * of them: added back, it is found again (REG-28).
 */
export function knownChatIds(bot: TelegramBot): ReadonlySet<string> {
  return new Set(bot.chats.filter((chat) => chat.membership === 'member').map((chat) => chat.id));
}

/** The channels a bot entered while the sheet was waiting for one. */
export function newChats(bot: TelegramBot | undefined, knownIds: ReadonlySet<string>): TelegramChat[] {
  return bot?.chats.filter((chat) => chat.membership === 'member' && !knownIds.has(chat.id)) ?? [];
}

/** A bot token, as @BotFather gives it; the server checks it again (`token_shape`). */
export function looksLikeToken(value: string): boolean {
  return /^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(value.trim());
}

/** Telegram's limit on a bot's identifier. */
const USERNAME_MAX = 32;

/**
 * The identifier @BotFather will accept for a name: starts with a letter, lowercase, underscores, ends in `bot`,
 * 32 characters at most. A name that already ends in « bot » gets no second one.
 */
export function suggestedUsername(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = words === '' ? 'impera' : /^[a-z]/.test(words) ? words : `impera_${words}`;
  if (base.endsWith('bot') && base.length >= 5 && base.length <= USERNAME_MAX) return base;
  const stem = base
    .replace(/_?bot$/, '')
    .slice(0, USERNAME_MAX - '_bot'.length)
    .replace(/_+$/, '');
  return `${stem === '' ? 'impera' : stem}_bot`;
}
