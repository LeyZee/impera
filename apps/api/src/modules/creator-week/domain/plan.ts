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
  /** Publications of the feed a week (ADR 0136: at least 3). */
  readonly feedPerWeek: number;
  /** Stories a week (ADR 0136: one a day). */
  readonly storiesPerWeek: number;
  /** The estimated shooting time of one of each need (§ 5). */
  readonly minutes: Readonly<Record<WeekNeed, number>>;
  /** The delivery's weekday (7 Sunday) and minute of her day (23 h) (§ 9). */
  readonly dueWeekday: number;
  readonly dueMinute: number;
}

/** Chosen by common sense on 20/11 and told to Charles: two days of 4 h; a script 1 h 30, a session 45 min. */
export const WEEK_DEFAULTS: WeekSettings = {
  shootDays: 2,
  capacityMinutes: 240,
  feedPerWeek: 3,
  storiesPerWeek: 7,
  minutes: { script: 90, feed_shoot: 45, feed_video: 30, mass_dm: 15, idea: 45, reveal_story: 10 },
  dueWeekday: 7,
  dueMinute: 23 * 60,
};

/** Her shooting days when she never had any and opens no dispo: Wednesday and Saturday, then the others. */
const FALLBACK_WEEKDAYS = [3, 6, 2, 4, 5, 1, 7] as const;

/** What a full week keeps first (§ 5): what blocks a sale, then the feed, the Relance, the ideas, the stories. */
const RANK: Readonly<Record<WeekNeed, number>> = {
  script: 0,
  feed_shoot: 1,
  feed_video: 1,
  mass_dm: 2,
  idea: 3,
  reveal_story: 4,
};

/** What the week is computed on, read by the code from her real figures, never by a model (§ 4, § 14). */
export interface WeekFacts {
  /** Her feed publications and stories received and not out yet. */
  readonly stock: { readonly feed: number; readonly stories: number };
  /** Her scripts asked and not answered, due by the end of the week, oldest due first. */
  readonly scripts: readonly { readonly requestId: ContentRequestId; readonly name: string | null }[];
}

/** Her sheets, written by the code (§ 14: without the AI, the week leaves all the same). */
const SHEETS: Readonly<Record<Exclude<WeekNeed, 'mass_dm' | 'idea'>, string>> = {
  script: 'Les photos et vidéos du script, étape par étape, comme la demande les décrit.',
  feed_shoot: 'Quelques photos d’une même tenue, pour une publication du feed.',
  feed_video: 'Une vidéo courte, quelques secondes, pour une publication du feed.',
  reveal_story: 'Des moments simples de ta journée, pour une story par jour.',
};

const storiesLabel = (count: number): string => (count === 1 ? '1 story' : `${String(count)} stories`);

/**
 * What there is to shoot for the week (§ 4), in the order a full week keeps them (§ 5): each script asked, the feed
 * publications the stock lacks (a session, then a short video, in turn), and the stories as one line. The media of
 * Relance and the ideas join when the Mass DM plan and the ideas do: none is ever made up here.
 */
export function weekNeeds(facts: WeekFacts, settings: WeekSettings = WEEK_DEFAULTS): WeekPlanItem[] {
  const items: WeekPlanItem[] = facts.scripts.map((script) => ({
    need: 'script',
    label: script.name === null ? 'Ton prochain script' : `Script « ${script.name} »`.slice(0, 120),
    sheet: SHEETS.script,
    minutes: settings.minutes.script,
    count: 1,
    requestId: script.requestId,
  }));
  const feed = Math.max(0, settings.feedPerWeek - facts.stock.feed);
  for (let index = 0; index < feed; index += 1) {
    const need = index % 2 === 0 ? 'feed_shoot' : 'feed_video';
    items.push({
      need,
      label: need === 'feed_shoot' ? 'Une séance pour le feed' : 'Une vidéo courte pour le feed',
      sheet: SHEETS[need],
      minutes: settings.minutes[need],
      count: 1,
      requestId: null,
    });
  }
  const stories = Math.min(50, Math.max(0, settings.storiesPerWeek - facts.stock.stories));
  if (stories > 0)
    items.push({
      need: 'reveal_story',
      label: storiesLabel(stories),
      sheet: SHEETS.reveal_story,
      minutes: settings.minutes.reveal_story * stories,
      count: stories,
      requestId: null,
    });
  // Stable: the order within a rank is the order above (the oldest script first).
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.need] - RANK[b.item.need] || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Her lines laid on her shooting days (§ 5): each, in order, on the day with the most room left (the earliest when two
 * tie), so that her days weigh alike. Stories are cut across days when a day cannot hold them all. What fits nowhere
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
      const part = splitStories(left, fits, each);
      placed[at]?.push(part.now);
      room[at] = free - part.now.minutes;
      left = part.later;
    }
  }
  return { shootDays: days.map((day, index) => ({ day, items: placed[index] ?? [] })), deferred };
}

function splitStories(
  item: WeekPlanItem,
  count: number,
  each: number,
): { readonly now: WeekPlanItem; readonly later: WeekPlanItem } {
  const rest = item.count - count;
  return {
    now: { ...item, count, minutes: Math.round(each * count), label: storiesLabel(count) },
    later: { ...item, count: rest, minutes: Math.round(each * rest), label: storiesLabel(rest) },
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
