import { DAY_ITEMS, DAY_TARGET_MAX, type DayItem, type DayLine, type DayPlatform } from '@impera/contracts';

import { addDays } from '../../scheduling/pure';

/**
 * Her day (ADR 0140, second avenant of 20/11/2026): what she posts each day, dictated by Charles (20/11), as lists she
 * ticks, her video of the day done by her coffre (avenant du 27/11). Nothing here is ever published. Until her own settings come, these are the values every day reads.
 */
export interface DaySettings {
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
  revealVideos: 1,
  instaStories: 4,
  instaPosts: 2,
  instaReels: 1,
  telegramWritten: 2,
  telegramVideos: 1,
};

interface ItemRule {
  readonly platform: DayPlatform;
  /** One of the essentials of the day (Charles, 20/11: her story to Reveal, her video). */
  readonly essential: boolean;
  /** `drop`: done by her coffre, never ticked (avenant du 27/11). */
  readonly source: 'tick' | 'drop';
  readonly target: (settings: DaySettings) => number;
  readonly label: (target: number) => string;
  readonly sheet: string;
}

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? `1 ${one}` : `${String(count)} ${many}`;

/** Each line of her day: where, how many, her words. Her video and her stories never go from Reveal to Instagram. */
const RULES: Readonly<Record<DayItem, ItemRule>> = {
  // Her Reveal story is the feed's video with a caption of its own, put out by Impera (Charles, 27/11; ADR 0136 § 11):
  // nothing for her to post, so the line asks nothing and her day leaves it out.
  reveal_story: {
    platform: 'reveal',
    essential: true,
    source: 'tick',
    target: () => 0,
    label: (n) => (n === 1 ? 'Ta story Reveal' : `${String(n)} stories Reveal`),
    sheet:
      'Un moment de ta journée, ce que tu veux. Tes abonnés voient que tu es là, et ça leur donne envie de t’écrire.',
  },
  // She drops it, Impera puts it out (Charles, 27/11): done by her coffre, never by a tick (avenant du 27/11).
  reveal_video: {
    platform: 'reveal',
    essential: true,
    source: 'drop',
    target: (s) => s.revealVideos,
    label: (n) => (n === 1 ? 'Ta vidéo du jour sur Reveal' : `${String(n)} vidéos du jour sur Reveal`),
    sheet:
      'Une vidéo du feed dans ton coffre : Impera la publie pour toi sur le fil vidéo public de Reveal. Elle reste sur Reveal, jamais sur Instagram.',
  },
  insta_cta_story: {
    platform: 'instagram',
    essential: true,
    source: 'tick',
    target: () => 1,
    label: () => 'Ta story qui mène à Reveal',
    sheet:
      'La plus importante de la journée sur Instagram : c’est elle qui fait venir tes nouveaux abonnés. Une photo sage qui donne envie d’en voir plus, une phrase qui intrigue, et le sticker lien vers ta page Reveal. Rien d’osé : Instagram ne pardonne pas.',
  },
  insta_stories: {
    platform: 'instagram',
    essential: false,
    source: 'tick',
    target: (s) => Math.max(0, s.instaStories - 1),
    label: (n) => plural(n, 'autre story Instagram', 'autres stories Instagram'),
    sheet: 'Ton quotidien, tes coulisses, ce qui te rend proche. Rien qui vienne de Reveal.',
  },
  insta_posts: {
    platform: 'instagram',
    essential: false,
    source: 'tick',
    target: (s) => s.instaPosts,
    label: (n) => plural(n, 'post Instagram', 'posts Instagram'),
    sheet:
      'Des photos qui restent sur ton profil et donnent envie de te suivre. Jamais une photo ni une vidéo de Reveal.',
  },
  insta_reel: {
    platform: 'instagram',
    essential: false,
    source: 'tick',
    target: (s) => s.instaReels,
    label: (n) => (n === 1 ? 'Ton Reel d’essai' : `${String(n)} Reels d’essai`),
    sheet: 'Un Reel court, pour tester une idée. On garde ce qui marche.',
  },
  telegram_posts: {
    platform: 'telegram',
    essential: false,
    source: 'tick',
    target: (s) => s.telegramWritten,
    label: (n) => plural(n, 'post écrit sur Telegram', 'posts écrits sur Telegram'),
    sheet: 'Quelques mots à ton canal : une pensée, une question, une nouvelle de ta journée.',
  },
  telegram_video: {
    platform: 'telegram',
    essential: false,
    source: 'tick',
    target: (s) => s.telegramVideos,
    label: () => 'Ce soir, ta vidéo du jour sur Telegram',
    sheet: 'Le soir, ta vidéo du jour de Reveal sur ton canal Telegram. Celle-là, tu peux la reprendre.',
  },
};

/** How many a line asks, within what a day holds. */
export const targetOf = (item: DayItem, settings: DaySettings): number =>
  Math.min(DAY_TARGET_MAX, Math.max(0, RULES[item].target(settings)));

/** What a day counts, line by line: what she ticked, and the feed's videos her coffre has for that day. */
export interface DayCounts {
  readonly ticked: Partial<Readonly<Record<DayItem, number>>>;
  readonly videos: number;
}

/** What she did of a line: her ticks, or her coffre for a line done by it; a tick on such a line counts for nothing. */
const doneOf = (item: DayItem, counts: DayCounts): number =>
  RULES[item].source === 'drop' ? counts.videos : (counts.ticked[item] ?? 0);

/** Whether she ticks a line: never one her coffre does. */
export const isTicked = (item: DayItem): boolean => RULES[item].source === 'tick';

/**
 * Her day as she reads it: the essentials first, then the bonus, each in the order of `DAY_ITEMS`. A line that asks
 * nothing is left out; what she did counts up to what the line asks, never beyond.
 */
export function dayLines(settings: DaySettings, counts: DayCounts): DayLine[] {
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
        done: Math.min(target, Math.max(0, doneOf(item, counts))),
        essential: rule.essential,
        source: rule.source,
      },
    ];
  });
  return [...lines.filter((line) => line.essential), ...lines.filter((line) => !line.essential)];
}

/** She ticks a day on that day and the day after, in her zone; an older day is read, never changed. */
export const canTickDay = (day: string, today: string): boolean =>
  day === today || day === addDays(today, -1);
