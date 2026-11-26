import {
  AVAILABILITY_RANGES_MAX,
  AVAILABILITY_STALE_DAYS,
  AVAILABILITY_STEP_MINUTES,
  type AvailabilityRange,
  type MemberAvailability,
  type TeamMember,
} from '@impera/contracts';

/** The weekly availability as the screens read it (ADR 0171, trou 16): pure, in the member's own zone. */

const STEP_MS = AVAILABILITY_STEP_MINUTES * 60_000;
const NBSP = ' ';

export const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;

const formats = new Map<string, Intl.DateTimeFormat>();
const formatOf = (zone: string): Intl.DateTimeFormat => {
  const known = formats.get(zone);
  if (known !== undefined) return known;
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formats.set(zone, made);
  return made;
};
const DAYS: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The day of the week (1 Monday … 7 Sunday) and the minute of that day of an instant, in `zone`. */
export function weekMinuteOf(at: Date, zone: string): { readonly weekday: number; readonly minute: number } {
  const parts = formatOf(zone).formatToParts(at);
  const part = (type: string): string => parts.find((one) => one.type === type)?.value ?? '';
  return {
    weekday: DAYS[part('weekday')] ?? 1,
    minute: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

const inside = (ranges: readonly AvailabilityRange[], at: { weekday: number; minute: number }): boolean =>
  ranges.some(
    (range) => range.weekday === at.weekday && range.startMinute <= at.minute && at.minute < range.endMinute,
  );

/** How a member's week covers a place: all of it, one stretch of it (the longest), or none. */
export type Cover =
  | { readonly kind: 'full' }
  | { readonly kind: 'part'; readonly from: Date; readonly to: Date }
  | { readonly kind: 'none' };

/**
 * Walks the place a quarter of an hour at a time, each read in the member's zone: a change of hour on his side or on
 * the agency's moves nothing by hand.
 */
export function coverOf(week: Pick<MemberAvailability, 'ranges' | 'timeZone'>, from: Date, to: Date): Cover {
  if (week.ranges.length === 0 || to <= from) return { kind: 'none' };
  let best: { from: number; to: number } | null = null;
  let run: number | null = null;
  let all = true;
  for (let at = from.getTime(); at < to.getTime(); at += STEP_MS) {
    if (inside(week.ranges, weekMinuteOf(new Date(at), week.timeZone))) {
      run ??= at;
      const end = Math.min(at + STEP_MS, to.getTime());
      if (best === null || end - run > best.to - best.from) best = { from: run, to: end };
    } else {
      all = false;
      run = null;
    }
  }
  if (all) return { kind: 'full' };
  return best === null
    ? { kind: 'none' }
    : { kind: 'part', from: new Date(best.from), to: new Date(best.to) };
}

export interface Dispo {
  readonly member: TeamMember;
  readonly cover: Cover;
}

/** Who can take a place (ADR 0171 § 5): the whole of it first, part of it after, and how many gave no week. */
export interface Dispos {
  readonly full: readonly Dispo[];
  readonly part: readonly Dispo[];
  readonly silent: number;
}

/**
 * The active members of the place's creator, with no shift over it (`busy`), by what their week covers of it. A
 * member with no week shows on no place: he is counted in `silent`.
 */
export function disposOn(
  place: { readonly creatorId: string; readonly from: Date; readonly to: Date },
  members: readonly TeamMember[],
  weeks: readonly MemberAvailability[],
  busy: (memberId: string) => boolean,
): Dispos {
  const byMember = new Map(weeks.map((week) => [week.memberId, week]));
  const full: Dispo[] = [];
  const part: Dispo[] = [];
  let silent = 0;
  for (const member of members) {
    if (member.status !== 'active' || !member.creatorIds.some((id) => id === place.creatorId)) continue;
    const week = byMember.get(member.id);
    if (week === undefined || week.setAt === null) {
      silent += 1;
      continue;
    }
    if (busy(member.id)) continue;
    const cover = coverOf(week, place.from, place.to);
    if (cover.kind === 'full') full.push({ member, cover });
    else if (cover.kind === 'part') part.push({ member, cover });
  }
  const byName = (a: Dispo, b: Dispo): number =>
    a.member.displayName.localeCompare(b.member.displayName, 'fr');
  return { full: full.toSorted(byName), part: part.toSorted(byName), silent };
}

/** « 2 dispos » on a place, `null` when nobody covers all of it. */
export const disposCountText = (dispos: Dispos): string | null =>
  dispos.full.length === 0
    ? null
    : `${String(dispos.full.length)}${NBSP}dispo${dispos.full.length > 1 ? 's' : ''}`;

/** « 2 membres n'ont pas donné leurs dispos », `null` when everyone did. */
export const silentText = (count: number): string | null =>
  count === 0
    ? null
    : count === 1
      ? '1 membre n’a pas donné ses dispos.'
      : `${String(count)} membres n’ont pas donné leurs dispos.`;

/** « 18 h – 0 h », a plage in its own zone, as the member gave it. */
export function rangeText(range: Pick<AvailabilityRange, 'startMinute' | 'endMinute'>): string {
  const clock = (minute: number): string => {
    const hours = Math.floor(minute / 60) % 24;
    const rest = minute % 60;
    return rest === 0
      ? `${String(hours)}${NBSP}h`
      : `${String(hours)}${NBSP}h${NBSP}${String(rest).padStart(2, '0')}`;
  };
  return `${clock(range.startMinute)} – ${clock(range.endMinute)}`;
}

/** His week is older than 30 days (§ 6): « Mes dispos » asks him, quietly, to look at it again. */
export function isStale(week: Pick<MemberAvailability, 'setAt'>, now: Date): boolean {
  return week.setAt !== null && now.getTime() - Date.parse(week.setAt) > AVAILABILITY_STALE_DAYS * 86_400_000;
}

const DAY_MINUTES = 24 * 60;

/** A plage as « Mes dispos » edits it: a day, a start, an end; an end at or before the start runs to the next day. */
export interface DraftRange {
  readonly key: number;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * The plages to send (ADR 0171 § 1): an end of « 0 h » is midnight, and a plage past midnight stops at the end of its
 * day and goes on the next morning. `null` for a plage whose end is its start: it says nothing.
 */
export function rangesOfDrafts(drafts: readonly DraftRange[]): AvailabilityRange[] | null {
  const ranges: AvailabilityRange[] = [];
  for (const draft of drafts) {
    const end = draft.endMinute === 0 ? DAY_MINUTES : draft.endMinute;
    if (end === draft.startMinute) return null;
    if (end > draft.startMinute) {
      ranges.push({ weekday: draft.weekday, startMinute: draft.startMinute, endMinute: end });
      continue;
    }
    ranges.push({ weekday: draft.weekday, startMinute: draft.startMinute, endMinute: DAY_MINUTES });
    ranges.push({ weekday: (draft.weekday % 7) + 1, startMinute: 0, endMinute: end });
  }
  return ranges.toSorted((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}

/** The week back as he gave it: a plage to midnight and its morning after, one plage again (« 22 h – 2 h »). */
export function draftsOf(ranges: readonly AvailabilityRange[]): DraftRange[] {
  const sorted = ranges.toSorted((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  // First the evenings to midnight with their morning after, so a Monday morning waits for Sunday night.
  const mornings = new Map<AvailabilityRange, AvailabilityRange>();
  const taken = new Set<AvailabilityRange>();
  for (const range of sorted) {
    if (range.endMinute !== DAY_MINUTES || range.startMinute === 0) continue;
    const morning = sorted.find(
      (next) =>
        !taken.has(next) &&
        next.weekday === (range.weekday % 7) + 1 &&
        next.startMinute === 0 &&
        next.endMinute < range.startMinute,
    );
    if (morning === undefined) continue;
    mornings.set(range, morning);
    taken.add(morning);
  }
  return sorted
    .filter((range) => !taken.has(range))
    .map((range, key) => ({
      key,
      weekday: range.weekday,
      startMinute: range.startMinute,
      endMinute: mornings.get(range)?.endMinute ?? (range.endMinute === DAY_MINUTES ? 0 : range.endMinute),
    }));
}

/** What holds the week back, said in his words; `null` when it can be sent. */
export function draftsIssue(drafts: readonly DraftRange[]): string | null {
  const ranges = rangesOfDrafts(drafts);
  if (ranges === null) return 'Une plage finit à l’heure où elle commence : corrige sa fin.';
  if (ranges.length > AVAILABILITY_RANGES_MAX)
    return `Au plus ${String(AVAILABILITY_RANGES_MAX)} plages par semaine : regroupe-en quelques-unes.`;
  const clash = ranges.find((range, index) =>
    ranges.some(
      (other, at) =>
        at !== index &&
        other.weekday === range.weekday &&
        other.startMinute < range.endMinute &&
        other.endMinute > range.startMinute,
    ),
  );
  return clash === undefined
    ? null
    : `Deux plages se chevauchent le ${(WEEKDAYS[clash.weekday - 1] ?? '').toLowerCase()}.`;
}

/** « 4 plages, du lundi au vendredi » would say too much: the count and the days, as the fold sums it. */
export function weekSum(ranges: readonly AvailabilityRange[]): string {
  if (ranges.length === 0) return 'Pas encore données';
  // Counted as he gave them: Friday night to 2 h is Friday's, not a day more.
  const days = new Set(draftsOf(ranges).map((draft) => draft.weekday)).size;
  return days === 1 ? '1 jour' : `${String(days)} jours`;
}
