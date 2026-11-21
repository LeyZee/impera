import {
  CHANNEL_SLOT_GAP_MINUTES,
  type ChannelPlannedKind,
  type ChannelSlot,
  type ChannelSlotRole,
  type ChannelTheme,
} from '@impera/contracts';

import { addDays, isoWeekday, wallClockToInstant } from '../../scheduling/pure';

/**
 * Her channel's week, planned on Saturday evening (ADR 0162 § 1 to § 3): for each switched-on slot of each day, an
 * hour drawn in its window, two hours after the previous post at least; a role, a kind and a theme chosen for variety.
 * Pure and seeded: the same creator and week give the same plan, so a replay never moves a post. No text here: the
 * voice writes it afterwards.
 */

/** The day the week is planned, and its hour on her clock (§ 3.1): Saturday, 18 h. */
export const PLAN_WEEKDAY = 6;
export const PLAN_MINUTE = 18 * 60;
/** The texts tied to the moment are written again the day before, at 18 h (§ 3.6). */
export const REFRESH_MINUTE = 18 * 60;

/** Polls in a week (« de temps en temps », § 1.2): at most one a day, never on two days in a row. */
export const POLLS_PER_WEEK = 3;
/** Opinions on her passions and their news (§ 4.2): twice a week. */
export const PASSION_PER_WEEK = 2;

export interface PlanInput {
  readonly creatorId: string;
  /** The Monday of the week, on her calendar. */
  readonly week: string;
  readonly timeZone: string;
  readonly slots: readonly ChannelSlot[];
  /** Photos of her Telegram stock ready to go out (§ 1.2): one a day at most, while there are some. */
  readonly photoStock: number;
  /** A real source of her day exists (§ 4.4): her Instagram, her line of the day. Without one, no « news » theme. */
  readonly hasNewsSource: boolean;
}

export interface PlannedSlot {
  readonly day: string;
  readonly window: { readonly from: number; readonly until: number };
  /** The drawn minute after her midnight, and the instant it names. */
  readonly minute: number;
  readonly at: Date;
  readonly role: ChannelSlotRole;
  readonly kind: ChannelPlannedKind;
  readonly theme: ChannelTheme;
}

/** A small seeded generator (mulberry32) over a string's hash: enough to scatter hours, not for secrets. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in [from, until]. */
const between = (random: () => number, from: number, until: number): number =>
  from + Math.floor(random() * (until - from + 1));

/** The days of the week, Monday to Sunday. */
export function weekDays(week: string): string[] {
  return Array.from({ length: 7 }, (_, rank) => addDays(week, rank));
}

/** The Monday of the week that follows the one `day` is in. */
export function nextWeekOf(day: string): string {
  return addDays(day, 8 - isoWeekday(day));
}

/** Three days out of seven, never two in a row, Monday to Sunday: where the polls go. */
function pollDays(random: () => number, count: number): Set<number> {
  const patterns = [
    [1, 3, 5],
    [1, 3, 6],
    [1, 4, 6],
    [2, 4, 6],
    [2, 4, 7],
    [2, 5, 7],
    [3, 5, 7],
    [1, 4, 7],
  ];
  const pattern = patterns[Math.floor(random() * patterns.length)] ?? [2, 4, 6];
  return new Set(pattern.slice(0, count));
}

const TEXT_THEMES: readonly ChannelTheme[] = ['chat', 'girly', 'news', 'girly', 'chat'];

export function planWeek(input: PlanInput): PlannedSlot[] {
  const random = seededRandom(`${input.creatorId}:${input.week}`);
  const polls = pollDays(random, POLLS_PER_WEEK);
  let photos = input.photoStock;
  let passions = 0;
  let themeTurn = Math.floor(random() * TEXT_THEMES.length);
  const planned: PlannedSlot[] = [];

  for (const day of weekDays(input.week)) {
    const weekday = isoWeekday(day);
    const spans = input.slots
      .filter((slot) => slot.enabled && slot.days.includes(weekday))
      .map((slot) => ({
        role: slot.role,
        from: slot.minute,
        until: Math.max(slot.minute, slot.untilMinute ?? slot.minute),
      }))
      .sort((a, b) => a.from - b.from);
    const engagement = spans.filter((span) => span.role === 'engagement');
    // The poll takes one engagement slot of its day, the photo the first engagement slot left.
    const pollRank =
      polls.has(weekday) && engagement.length > 0 ? Math.floor(random() * engagement.length) : -1;
    let photoGiven = false;
    let previous: number | null = null;

    for (const span of spans) {
      const earliest: number =
        previous === null ? span.from : Math.max(span.from, previous + CHANNEL_SLOT_GAP_MINUTES);
      const minute: number = earliest > span.until ? earliest : between(random, earliest, span.until);
      previous = minute;
      let kind: ChannelPlannedKind;
      let theme: ChannelTheme;
      if (span.role === 'main') {
        kind = 'main';
        theme = 'evening';
      } else if (engagement.indexOf(span) === pollRank) {
        kind = 'poll';
        theme = 'poll';
      } else {
        if (!photoGiven && photos > 0) {
          kind = 'photo';
          photos -= 1;
          photoGiven = true;
        } else {
          kind = 'text';
        }
        // Her passions twice a week, on an afternoon text when one comes; the rest turns among the others.
        if (passions < PASSION_PER_WEEK && span.from >= 12 * 60 && weekday % 3 === passions % 3) {
          theme = 'passion';
          passions += 1;
        } else {
          let next = TEXT_THEMES[themeTurn % TEXT_THEMES.length] ?? 'chat';
          themeTurn += 1;
          if (next === 'news' && !input.hasNewsSource) next = 'girly';
          theme = next;
        }
      }
      planned.push({
        day,
        window: { from: span.from, until: span.until },
        minute,
        at: wallClockToInstant(day, minute, input.timeZone),
        role: span.role,
        kind,
        theme,
      });
    }
  }
  return planned;
}

/**
 * The text of a post is written again the day before (§ 3.6) when it hangs on the moment (her passions' news, a piece
 * of news, the evening's visual) and nobody locked it.
 */
export function needsRefresh(theme: ChannelTheme, locked: boolean): boolean {
  return !locked && (theme === 'passion' || theme === 'news' || theme === 'evening');
}
