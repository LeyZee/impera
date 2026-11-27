import type { ContentRequestId, WeekNeed, WeekPlanDay, WeekPlanItem } from '@impera/contracts';

import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from '../../scheduling/pure';

/**
 * The agency's settings of her week (ADR 0140 § 1, § 4, § 5, § 9), with the code's values by default. The ADR makes
 * each of them a setting per creator; until the setting's screen exists, these are the values every week reads.
 */
export interface WeekSettings {
  /** How many shooting days the agency asks of her (§ 1.3): never more are proposed. */
  readonly shootDays: number;
  /** What one shooting day holds (§ 5). */
  readonly capacityMinutes: number;
  /** Boudoir sessions a week (Charles, 20/11: 3 is the ideal). Each feeds the feed, the Mass DM and the gifts. */
  readonly sessionsPerWeek: number;
  /** Short videos for Reveal's public video feed a week (Charles, 20/11: one a day). */
  readonly videosPerWeek: number;
  /** A script is asked when none arrived for this many days and none is asked already (Charles, 20/11: two weeks). */
  readonly scriptEveryDays: number;
  /** Photos kept from each session for the gifts to the whales, never published, never nude (Charles, 20/11). */
  readonly giftsPerSession: number;
  /** The estimated shooting time of one of each need (§ 5). */
  readonly minutes: Readonly<Record<WeekNeed, number>>;
  /** The delivery's weekday (7 Sunday) and minute of her day (23 h) (§ 9). */
  readonly dueWeekday: number;
  readonly dueMinute: number;
}

/**
 * Charles's rhythm (20/11): 3 boudoir sessions, a video a day for the public feed, a script every two weeks; no story
 * of her own since 27/11, her Reveal story is the feed's video (ADR 0136 § 11). Chosen by common sense and told to him: two days of 4 h; a script 1 h 30, a session 1 h, a video or a story
 * 5 min; 2 gift photos a session.
 */
export const WEEK_DEFAULTS: WeekSettings = {
  shootDays: 2,
  capacityMinutes: 240,
  sessionsPerWeek: 3,
  videosPerWeek: 7,
  scriptEveryDays: 14,
  giftsPerSession: 2,
  minutes: { script: 90, feed_shoot: 60, feed_video: 5, mass_dm: 0, idea: 45, reveal_story: 5 },
  dueWeekday: 7,
  dueMinute: 23 * 60,
};

/** Her shooting days when she never had any and opens no dispo: Wednesday and Saturday, then the others. */
const FALLBACK_WEEKDAYS = [3, 6, 2, 4, 5, 1, 7] as const;

/** What a full week keeps first (§ 5): what blocks a sale, then the sessions, the daily videos, the ideas, the stories. */
const RANK: Readonly<Record<WeekNeed, number>> = {
  script: 0,
  feed_shoot: 1,
  feed_video: 2,
  mass_dm: 3,
  idea: 4,
  reveal_story: 5,
};

/** What the week is computed on, read by the code from her real figures, never by a model (§ 4, § 14). */
export interface WeekFacts {
  /** Her sessions, public-feed videos and stories received and not out yet. */
  readonly stock: { readonly sessions: number; readonly videos: number; readonly stories: number };
  /** Her scripts asked and not answered, due by the end of the week, oldest due first. */
  readonly scripts: readonly { readonly requestId: ContentRequestId; readonly name: string | null }[];
  /** The day her last script arrived, in her zone; `null` when none ever did. */
  readonly lastScriptOn: string | null;
}

/** Her sheets, written by the code (§ 14: without the AI, the week leaves all the same). */
const SHEETS = {
  script: 'Les photos et vidéos du script, étape par étape, comme la demande les décrit.',
  next_script: 'Un nouveau script à tourner : l’agence t’envoie ses étapes avant ton jour de tournage.',
  feed_video:
    'Courtes et sexy, une par jour, pour le feed vidéo public de Reveal : c’est ce qui fait venir de nouveaux fans. Jamais sur Instagram, c’est trop chaud pour lui.',
} as const;

/** A boudoir session's sheet: everything it feeds, so that she brings back each piece in one sitting. */
const sessionSheet = (gifts: number): string =>
  [
    'Une tenue, une lumière : de quoi faire le post, le Mass DM et les cadeaux.',
    'Tu ramènes :',
    '• les photos et deux ou trois vidéos de quelques secondes pour le post du feed ;',
    '• une photo ou une vidéo pour annoncer la séance en Mass DM ;',
    gifts === 1
      ? '• 1 jolie photo sexy rien que pour les cadeaux, jamais publiée, jamais nue.'
      : `• ${String(gifts)} jolies photos sexy rien que pour les cadeaux, jamais publiées, jamais nues.`,
  ].join('\n');

/** « 1 vidéo du jour », « 7 vidéos du jour »: the label of a line cut by count (a story line of an older week too). */
function countLabel(need: WeekNeed, count: number): string {
  if (need === 'feed_video') return count === 1 ? '1 vidéo du jour' : `${String(count)} vidéos du jour`;
  return count === 1 ? '1 story' : `${String(count)} stories`;
}

/**
 * What there is to shoot for the week (§ 4), in the order a full week keeps them (§ 5): each script asked, or the next
 * script when none arrived for `scriptEveryDays`; the boudoir sessions the stock lacks; the videos of the public feed as
 * one line. No story: her Reveal story is the feed's video. A session feeds its Mass DM and the gifts too, said on its sheet. The ideas join
 * when they do: none is ever made up here.
 */
export function weekNeeds(
  facts: WeekFacts,
  week: string,
  settings: WeekSettings = WEEK_DEFAULTS,
): WeekPlanItem[] {
  const items: WeekPlanItem[] = facts.scripts.map((script) => ({
    need: 'script',
    label: script.name === null ? 'Ton prochain script' : `Script « ${script.name} »`.slice(0, 120),
    sheet: SHEETS.script,
    minutes: settings.minutes.script,
    count: 1,
    requestId: script.requestId,
  }));
  const scriptDue =
    facts.lastScriptOn === null || facts.lastScriptOn <= addDays(week, -settings.scriptEveryDays);
  if (items.length === 0 && scriptDue)
    items.push({
      need: 'script',
      label: 'Ton prochain script',
      sheet: SHEETS.next_script,
      minutes: settings.minutes.script,
      count: 1,
      requestId: null,
    });
  const sessions = Math.max(0, settings.sessionsPerWeek - facts.stock.sessions);
  for (let index = 0; index < sessions; index += 1)
    items.push({
      need: 'feed_shoot',
      label: 'Une séance boudoir',
      sheet: sessionSheet(settings.giftsPerSession),
      minutes: settings.minutes.feed_shoot,
      count: 1,
      requestId: null,
    });
  // Her Reveal story is the feed's video with a caption of its own (Charles, 27/11): never a line of its own.
  const videos = Math.min(50, Math.max(0, settings.videosPerWeek - facts.stock.videos));
  if (videos > 0)
    items.push({
      need: 'feed_video',
      label: countLabel('feed_video', videos),
      sheet: SHEETS.feed_video,
      minutes: settings.minutes.feed_video * videos,
      count: videos,
      requestId: null,
    });
  // Stable: the order within a rank is the order above (the oldest script first).
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.need] - RANK[b.item.need] || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * What her delivery asks beside her lines (§ 25): each boudoir session brings back the photo or video of its Mass DM.
 */
export function deliveryAsks(lines: readonly Pick<WeekPlanItem, 'need' | 'count'>[]): Map<WeekNeed, number> {
  const asked = new Map<WeekNeed, number>();
  const add = (need: WeekNeed, count: number): void => {
    asked.set(need, (asked.get(need) ?? 0) + count);
  };
  for (const line of lines) {
    add(line.need, line.count);
    if (line.need === 'feed_shoot') add('mass_dm', line.count);
  }
  return asked;
}

/**
 * Her lines laid on her shooting days (§ 5): each, in order, on the day with the most room left (the earliest when two
 * tie), so that her days weigh alike. Stories and daily videos are cut across days when a day cannot hold them all. What fits nowhere
 * moves to the week after: never a week heavier than her days.
 */
export function packWeek(
  needs: readonly WeekPlanItem[],
  days: readonly string[],
  capacityMinutes: number,
): { readonly shootDays: WeekPlanDay[]; readonly deferred: WeekPlanItem[] } {
  const room = days.map(() => capacityMinutes);
  const placed: WeekPlanItem[][] = days.map(() => []);
  const deferred: WeekPlanItem[] = [];
  const roomiest = (): number =>
    room.reduce((best, left, index) => (left > (room[best] ?? -1) ? index : best), 0);
  for (const need of needs) {
    let left: WeekPlanItem | null = need;
    while (left !== null) {
      const at = roomiest();
      const free = room[at] ?? 0;
      if (left.minutes <= free) {
        placed[at]?.push(left);
        room[at] = free - left.minutes;
        left = null;
        continue;
      }
      const each = left.minutes / left.count;
      const fits = left.count > 1 ? Math.floor(free / each) : 0;
      if (fits < 1) {
        deferred.push(left);
        left = null;
        continue;
      }
      const part = splitByCount(left, fits, each);
      placed[at]?.push(part.now);
      room[at] = free - part.now.minutes;
      left = part.later;
    }
  }
  return { shootDays: days.map((day, index) => ({ day, items: placed[index] ?? [] })), deferred };
}

function splitByCount(
  item: WeekPlanItem,
  count: number,
  each: number,
): { readonly now: WeekPlanItem; readonly later: WeekPlanItem } {
  const rest = item.count - count;
  return {
    now: { ...item, count, minutes: Math.round(each * count), label: countLabel(item.need, count) },
    later: { ...item, count: rest, minutes: Math.round(each * rest), label: countLabel(item.need, rest) },
  };
}

/**
 * Her shooting days of the week starting `week` (§ 1): the weekdays she kept the week before, as she moved them; else
 * the weekdays of her dispos with the most time (the earliest when two tie); else Wednesday and Saturday. Never more
 * than `count`, completed when she kept fewer.
 */
export function chooseShootDays(
  week: string,
  previousDays: readonly string[],
  dispoMinutes: ReadonlyMap<number, number>,
  count: number,
): string[] {
  const chosen: number[] = [];
  const take = (weekday: number): void => {
    if (chosen.length < count && !chosen.includes(weekday)) chosen.push(weekday);
  };
  for (const day of [...previousDays].sort()) take(isoWeekday(day));
  const byTime = [...dispoMinutes.entries()]
    .filter(([, minutes]) => minutes > 0)
    .sort(([dayA, a], [dayB, b]) => b - a || dayA - dayB);
  for (const [weekday] of byTime) take(weekday);
  for (const weekday of FALLBACK_WEEKDAYS) take(weekday);
  return chosen.sort((a, b) => a - b).map((weekday) => addDays(week, weekday - 1));
}

/** The delivery's deadline (§ 9): her Sunday of the week at 23 h, in her zone. */
export function deliveryDue(week: string, timeZone: string, settings: WeekSettings = WEEK_DEFAULTS): Date {
  return wallClockToInstant(addDays(week, settings.dueWeekday - 1), settings.dueMinute, timeZone);
}

/** When the week after is computed (ADR 0042 § 5, the Sunday brief): her Sunday at 18 h. */
const PLAN_MINUTE = 18 * 60;

/**
 * The week the job computes for her at `now` (§ 2): the next one, once her Sunday's 18 h has passed; `null` before.
 * Her Monday.
 */
export function weekToPlan(now: Date, timeZone: string): string | null {
  const today = calendarDayIn(now, timeZone);
  if (isoWeekday(today) !== 7) return null;
  return now >= wallClockToInstant(today, PLAN_MINUTE, timeZone) ? addDays(today, 1) : null;
}

/** Her Monday of the week `day` is in. */
export const mondayOf = (day: string): string => addDays(day, 1 - isoWeekday(day));

/** Whether every shooting day falls in the week starting `week`. */
export const daysInWeek = (week: string, days: readonly string[]): boolean =>
  days.every((day) => day >= week && day <= addDays(week, 6));
