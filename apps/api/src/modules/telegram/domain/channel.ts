import {
  CHANNEL_POSTS_PER_DAY_MAX,
  CHANNEL_SLOT_GAP_MINUTES,
  type ChannelChoice,
  type ChannelRefusal,
  type ChannelSlot,
  type ChannelWarning,
  type TelegramChannelConfig,
  type TelegramChatId,
} from '@impera/contracts';

import type { ChatRecord } from './ports';

/**
 * The creator's Telegram channel (ADR 0080 § 1, § 4, § 6): what a save may hold, which channels she is offered and
 * what keeps her posts from going out. Pure.
 */

const MINUTES_PER_DAY = 1440;
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

const NBSP = '\u00a0';

const dayName = (day: number): string => DAY_NAMES[day - 1] ?? '';

/** « 19 h », « 19 h 30 ». */
const clockWords = (minute: number): string => {
  const m = minute % 60;
  return `${String(Math.floor(minute / 60))}${NBSP}h${m === 0 ? '' : `${NBSP}${String(m).padStart(2, '0')}`}`;
};

/** Days sorted, slots by hour then first day: what is stored and what comes back. */
export function normalizedConfig(config: TelegramChannelConfig): TelegramChannelConfig {
  const slots = config.slots
    .map((slot) => ({ ...slot, days: [...slot.days].sort((a, b) => a - b) }))
    .sort((a, b) => a.minute - b.minute || (a.days[0] ?? 0) - (b.days[0] ?? 0));
  return { ...config, slots };
}

/** The hours of the switched-on slots of each ISO day (1 to 7), sorted. */
function minutesByDay(slots: readonly ChannelSlot[]): Map<number, number[]> {
  const byDay = new Map<number, number[]>();
  for (let day = 1; day <= 7; day += 1) byDay.set(day, []);
  for (const slot of slots) {
    if (!slot.enabled) continue;
    for (const day of slot.days) byDay.get(day)?.push(slot.minute);
  }
  for (const minutes of byDay.values()) minutes.sort((a, b) => a - b);
  return byDay;
}

/** ADR 0080 § 1.5: one main post a day at most, the others are engagement. */
function mainRefusal(slots: readonly ChannelSlot[]): ChannelRefusal | null {
  for (let day = 1; day <= 7; day += 1) {
    const mains = slots.filter((slot) => slot.enabled && slot.role === 'main' && slot.days.includes(day));
    const [first, second] = mains;
    if (first !== undefined && second !== undefined) {
      return {
        kind: 'two_main_posts',
        message: `Le ${dayName(day)}, ${clockWords(first.minute)} et ${clockWords(second.minute)} sont tous deux le post principal : un seul par jour.`,
      };
    }
  }
  return null;
}

/** ADR 0080 § 1.1 and § 1.3: four posts a day at most, three hours apart at least, across midnight too. */
function slotRefusal(slots: readonly ChannelSlot[]): ChannelRefusal | null {
  const main = mainRefusal(slots);
  if (main !== null) return main;
  const byDay = minutesByDay(slots);
  for (const [day, minutes] of byDay) {
    if (minutes.length > CHANNEL_POSTS_PER_DAY_MAX) {
      return {
        kind: 'too_many_posts',
        message: `Le ${dayName(day)} a ${String(minutes.length)} posts : ${String(CHANNEL_POSTS_PER_DAY_MAX)} par jour au plus.`,
      };
    }
    for (let i = 1; i < minutes.length; i += 1) {
      const before = minutes[i - 1] ?? 0;
      const after = minutes[i] ?? 0;
      if (after - before < CHANNEL_SLOT_GAP_MINUTES) {
        return {
          kind: 'slots_too_close',
          message: `Le ${dayName(day)}, ${clockWords(before)} et ${clockWords(after)} sont trop proches : 3 h d’écart au moins.`,
        };
      }
    }
    const last = minutes.at(-1);
    const next = byDay.get((day % 7) + 1)?.[0];
    if (
      last !== undefined &&
      next !== undefined &&
      MINUTES_PER_DAY - last + next < CHANNEL_SLOT_GAP_MINUTES
    ) {
      return {
        kind: 'slots_too_close',
        message: `${clockWords(last)} le ${dayName(day)} et ${clockWords(next)} le ${dayName((day % 7) + 1)} sont trop proches : 3 h d’écart au moins.`,
      };
    }
  }
  return null;
}

/** One address however it is typed: the host in lower case (`URL` does it), no trailing slash. */
function sameAddress(url: string): string {
  return new URL(url).href.replace(/\/+$/u, '');
}

function linkRefusal(config: TelegramChannelConfig): ChannelRefusal | null {
  const names = new Set<string>();
  const urls = new Set<string>();
  for (const link of config.links) {
    const name = link.name.toLocaleLowerCase('fr');
    if (names.has(name)) {
      return { kind: 'link_name_taken', message: `Deux liens s’appellent « ${link.name} » : renomme l’un.` };
    }
    const address = sameAddress(link.url);
    if (urls.has(address)) {
      return {
        kind: 'link_url_taken',
        message: `L’adresse du lien « ${link.name} » est déjà dans la liste.`,
      };
    }
    names.add(name);
    urls.add(address);
  }
  if (config.channelLinkId !== null && !config.links.some((link) => link.id === config.channelLinkId)) {
    return {
      kind: 'channel_link_unknown',
      message: 'Le lien du canal n’est plus dans la liste : choisis-en un autre.',
    };
  }
  return null;
}

export interface ChannelContext {
  readonly chats: readonly ChatRecord[];
  /** The chats chosen by other creators. */
  readonly takenByOthers: ReadonlySet<TelegramChatId>;
  /** The chats an alert route points at. */
  readonly routed: ReadonlySet<TelegramChatId>;
}

function chatRefusal(chatId: TelegramChatId | null, context: ChannelContext): ChannelRefusal | null {
  if (chatId === null) return null;
  const chat = context.chats.find((candidate) => candidate.id === chatId);
  if (chat === undefined) {
    return {
      kind: 'chat_unknown',
      message: 'Le bot ne voit plus ce canal : choisis-en un autre, ou retire-le.',
    };
  }
  if (chat.kind !== 'channel') {
    return {
      kind: 'chat_not_channel',
      message: `« ${chat.title} » est un groupe, pas un canal : les posts vont dans son canal.`,
    };
  }
  if (context.takenByOthers.has(chatId)) {
    return { kind: 'chat_taken', message: `« ${chat.title} » est déjà le canal d’une autre créatrice.` };
  }
  if (context.routed.has(chatId)) {
    return {
      kind: 'chat_routed',
      message: `« ${chat.title} » reçoit des alertes de l’agence : retire-le du routage dans Réglages › Telegram d’abord.`,
    };
  }
  return null;
}

/** The first thing that keeps a save out, or null. */
export function channelRefusal(
  config: TelegramChannelConfig,
  context: ChannelContext,
): ChannelRefusal | null {
  return slotRefusal(config.slots) ?? linkRefusal(config) ?? chatRefusal(config.chatId, context);
}

/** The channels the bot sits in, as the screen offers them; groups are never offered. */
export function channelChoices(context: ChannelContext): ChannelChoice[] {
  return context.chats
    .filter((chat) => chat.kind === 'channel')
    .map((chat) => ({
      chatId: chat.id,
      title: chat.title,
      membership: chat.membership,
      canPost: chat.membership === 'member' && chat.canPost,
      takenByOther: context.takenByOthers.has(chat.id),
      routedForAlerts: context.routed.has(chat.id),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

/** What keeps her posts from going out (ADR 0080 § 4.4, § 6.1), in the order the screen says them. */
export function channelWarnings(
  config: TelegramChannelConfig,
  chats: readonly ChatRecord[],
  hasUsableBot: boolean,
): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  if (!hasUsableBot) warnings.push('no_bot');
  const chat = config.chatId === null ? undefined : chats.find((candidate) => candidate.id === config.chatId);
  if (config.chatId === null) warnings.push('no_channel');
  else if (chat?.membership !== 'member') warnings.push('channel_gone');
  else if (!chat.canPost) warnings.push('bot_cannot_post');
  if (config.channelLinkId === null) warnings.push('no_link');
  if (!config.slots.some((slot) => slot.enabled)) warnings.push('no_slot');
  return warnings;
}
