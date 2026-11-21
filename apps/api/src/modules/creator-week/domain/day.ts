import { DAY_ITEMS, DAY_TARGET_MAX, type DayItem, type DayLine, type DayPlatform } from '@impera/contracts';

import { addDays } from '../../scheduling/pure';

/**
 * Her day (ADR 0140, second avenant of 20/11/2026): what she posts each day, dictated by Charles (20/11), as lists she
 * ticks. Nothing here is ever published for her. Until her own settings come, these are the values every day reads.
 */
export interface DaySettings {
  /** Her story on Reveal (one a day). */
  readonly revealStories: number;
  /** Her video of the day on Reveal's public video feed (one a day), never on Instagram. */
  readonly revealVideos: number;
  /** Her Instagram stories, the one that leads to Reveal included (at least 4). */
  readonly instaStories: number;
  /** Her Instagram posts (2). */
  readonly instaPosts: number;
  /** Her trial Reels (1). */
  readonly instaReels: number;
  /** Her written Telegram posts (2), beside the evening one with the video of the day. */
  readonly telegramWritten: number;
  /** Her evening Telegram post with the video of the day (1). */
  readonly telegramVideos: number;
}

/** Charles's rhythm (20/11). */
export const DAY_DEFAULTS: DaySettings = {
  revealStories: 1,
  revealVideos: 1,
  instaStories: 4,
  instaPosts: 2,
  instaReels: 1,
  telegramWritten: 2,
  telegramVideos: 1,
};

interface ItemRule {
  readonly platform: DayPlatform;
  /** One of the essentials of the day (Charles, 20/11: her Reveal story, her story to Reveal, her video). */
  readonly essential: boolean;
  readonly target: (settings: DaySettings) => number;
  readonly label: (target: number) => string;
  readonly sheet: string;
}

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? `1 ${one}` : `${String(count)} ${many}`;

/** Each line of her day: where, how many, her words. Her video and her stories never go from Reveal to Instagram. */
const RULES: Readonly<Record<DayItem, ItemRule>> = {
  reveal_story: {
    platform: 'reveal',
    essential: true,
    target: (s) => s.revealStories,
    label: (n) => (n === 1 ? 'Ta story Reveal' : `${String(n)} stories Reveal`),
    sheet:
      'Un moment de ta journée, ce que tu veux. Tes abonnés voient que tu es là, et ça leur donne envie de t’écrire.',
  },
  reveal_video: {
    platform: 'reveal',
    essential: true,
    target: (s) => s.revealVideos,
    label: (n) => (n === 1 ? 'Ta vidéo du jour sur Reveal' : `${String(n)} vidéos du jour sur Reveal`),
    sheet:
      'Une des vidéos du jour de ton tournage, sur le fil vidéo public de Reveal. Elle reste sur Reveal : jamais sur Instagram.',
  },
  insta_cta_story: {
    platform: 'instagram',
    essential: true,
    target: () => 1,
    label: () => 'Ta story qui mène à Reveal',
    sheet:
      'La plus importante de la journée sur Instagram : c’est elle qui fait venir tes nouveaux abonnés. Une photo sage qui donne envie d’en voir plus, une phrase qui intrigue, et le sticker lien vers ta page Reveal. Rien d’osé : Instagram ne pardonne pas.',
  },
  insta_stories: {
    platform: 'instagram',
    essential: false,
    target: (s) => Math.max(0, s.instaStories - 1),
    label: (n) => plural(n, 'autre story Instagram', 'autres stories Instagram'),
    sheet: 'Ton quotidien, tes coulisses, ce qui te rend proche. Rien qui vienne de Reveal.',
  },
  insta_posts: {
    platform: 'instagram',
    essential: false,
    target: (s) => s.instaPosts,
    label: (n) => plural(n, 'post Instagram', 'posts Instagram'),
    sheet:
      'Des photos qui restent sur ton profil et donnent envie de te suivre. Jamais une photo ni une vidéo de Reveal.',
  },
  insta_reel: {
    platform: 'instagram',
    essential: false,
    target: (s) => s.instaReels,
    label: (n) => (n === 1 ? 'Ton Reel d’essai' : `${String(n)} Reels d’essai`),
    sheet: 'Un Reel court, pour tester une idée. On garde ce qui marche.',
  },
  telegram_posts: {
    platform: 'telegram',
    essential: false,
    target: (s) => s.telegramWritten,
    label: (n) => plural(n, 'post écrit sur Telegram', 'posts écrits sur Telegram'),
    sheet: 'Quelques mots à ton canal : une pensée, une question, une nouvelle de ta journée.',
  },
  telegram_video: {
    platform: 'telegram',
    essential: false,
    target: (s) => s.telegramVideos,
    label: () => 'Ce soir, ta vidéo du jour sur Telegram',
    sheet: 'Le soir, ta vidéo du jour de Reveal sur ton canal Telegram. Celle-là, tu peux la reprendre.',
  },
};

/** How many a line asks, within what a day holds. */
export const targetOf = (item: DayItem, settings: DaySettings): number =>
  Math.min(DAY_TARGET_MAX, Math.max(0, RULES[item].target(settings)));

/**
 * Her day as she reads it: the essentials first, then the bonus, each in the order of `DAY_ITEMS`. A line that asks
 * nothing is left out; what she did counts up to what the line asks, never beyond.
 */
export function dayLines(settings: DaySettings, done: Partial<Readonly<Record<DayItem, number>>>): DayLine[] {
  const lines = DAY_ITEMS.flatMap((item): DayLine[] => {
    const target = targetOf(item, settings);
    if (target === 0) return [];
    const rule = RULES[item];
    return [
      {
        item,
        platform: rule.platform,
        label: rule.label(target),
        sheet: rule.sheet,
        target,
        done: Math.min(target, Math.max(0, done[item] ?? 0)),
        essential: rule.essential,
      },
    ];
  });
  return [...lines.filter((line) => line.essential), ...lines.filter((line) => !line.essential)];
}

/** She ticks a day on that day and the day after, in her zone; an older day is read, never changed. */
export const canTickDay = (day: string, today: string): boolean =>
  day === today || day === addDays(today, -1);
