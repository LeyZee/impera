import type { ChannelPlannedKind, ChannelPlannedPost, ChannelTheme, ChannelWeek } from '@impera/contracts';

/*
 * Her channel's week as the review reads it (ADR 0162 § 3): the answer first (how many posts wait for a read, until
 * when), then her seven days and their posts by hour. Pure: the page gives the week, the hour and her time zone.
 */

/** One colour per kind of post, the same in the dots, the donut and the cards (règle d'écran, 21/11). */
export const KIND_COLOUR: Readonly<Record<ChannelPlannedKind, string>> = {
  main: 'var(--nv-series-1)',
  text: 'var(--nv-series-2)',
  photo: 'var(--nv-series-3)',
  poll: 'var(--nv-series-4)',
};

export const KIND_LABEL: Readonly<Record<ChannelPlannedKind, string>> = {
  main: 'Le post du soir',
  text: 'Texte',
  photo: 'Photo',
  poll: 'Sondage',
};

/** The donut's and the legend's order: the evening's post first, it carries the link. */
export const KINDS: readonly ChannelPlannedKind[] = ['main', 'text', 'photo', 'poll'];

export const THEME_LABEL: Readonly<Record<ChannelTheme, string>> = {
  girly: 'Question de fille',
  passion: 'Ses passions',
  chat: 'Envie de parler',
  news: 'Petite actu',
  poll: 'Sondage',
  evening: 'Appel du soir',
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dayDate = (day: string): Date => new Date(`${day}T12:00:00Z`);
const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

/** The Monday of the week holding this calendar day. */
export function mondayOf(day: string): string {
  const date = dayDate(day);
  const back = (date.getUTCDay() + 6) % 7;
  return isoDay(new Date(date.getTime() - back * DAY_MS));
}

export function addDays(day: string, days: number): string {
  return isoDay(new Date(dayDate(day).getTime() + days * DAY_MS));
}

/** Her calendar day at this instant. */
export function dayIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The week the review opens on: hers this week, or the coming one from Saturday, when the coming week is planned
 * (Saturday 18 h, § 2.3) and is the one left to read.
 */
export function weekToOpen(now: Date, timeZone: string): string {
  const today = dayIn(now, timeZone);
  const weekday = (dayDate(today).getUTCDay() + 6) % 7;
  return weekday >= 5 ? addDays(mondayOf(today), 7) : mondayOf(today);
}

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const dayNumber = (day: string): number => dayDate(day).getUTCDate();
const monthName = (day: string): string => MONTHS[dayDate(day).getUTCMonth()] ?? '';

/** « Du lundi 24 au dimanche 30 novembre », or across two months « Du lundi 29 décembre au dimanche 4 janvier ». */
export function weekWords(week: string): string {
  const last = addDays(week, 6);
  const sameMonth = monthName(week) === monthName(last);
  return `Du lundi ${String(dayNumber(week))}${sameMonth ? '' : ` ${monthName(week)}`} au dimanche ${String(dayNumber(last))} ${monthName(last)}`;
}

/** The post's hour on her clock, « 19:48 ». */
export function hourOf(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(at),
  );
}

const hourWords = (minute: number): string => {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return minutes === 0
    ? `${String(hours)}\u00a0h`
    : `${String(hours)}\u00a0h\u00a0${String(minutes).padStart(2, '0')}`;
};

/** Its window, « 18 h – 21 h ». */
export function windowWords(window: { from: number; until: number }): string {
  return `${hourWords(window.from)} – ${hourWords(window.until)}`;
}

/** Matin, après-midi or soir, from the hour its window opens. */
export function partOfDay(minute: number): string {
  if (minute < 12 * 60) return 'matin';
  if (minute < 18 * 60) return 'après-midi';
  return 'soir';
}

/** A gesture is still possible: it waits for its hour, and the hour has not come. */
export function isOpen(post: ChannelPlannedPost, now: Date): boolean {
  return post.state === 'planned' && new Date(post.at).getTime() > now.getTime();
}

/** Waits for a read: open and nobody validated, edited or rewrote it yet. */
export function waitsForRead(post: ChannelPlannedPost, now: Date): boolean {
  return isOpen(post, now) && !post.locked;
}

/** `todo`: waits for a read, said strong; `done`: read or left, set back; `warn`: not sent; `quiet`: removed. */
export type PostTone = 'todo' | 'done' | 'warn' | 'quiet';

const REVIEW_WORDS = {
  validated: 'Validé',
  edited: 'Modifié',
  rewritten: 'Réécrit',
  visual_changed: 'Visuel changé',
  removed: 'Retiré',
} as const;

/** The line under a post: who read it, or that it left, or why it did not, in its tone. */
export function stateLine(post: ChannelPlannedPost, timeZone: string): { text: string; tone: PostTone } {
  if (post.state === 'sent') {
    return { text: `Parti à ${hourOf(post.sentAt ?? post.at, timeZone)}`, tone: 'done' };
  }
  if (post.state === 'skipped' || post.state === 'failed') {
    return { text: post.reason ?? 'Il n’est pas parti.', tone: 'warn' };
  }
  if (post.state === 'removed') {
    const by = post.review === null ? '' : ` par ${post.review.byName}`;
    return { text: `Retiré${by} : un autre post prend sa place.`, tone: 'quiet' };
  }
  if (post.review !== null) {
    return { text: `${REVIEW_WORDS[post.review.action]} par ${post.review.byName}`, tone: 'done' };
  }
  return { text: 'À relire', tone: 'todo' };
}

/** What the card shows of its text: the post's words without the markup, or the poll's question and options. */
export function draftWords(post: ChannelPlannedPost): { text: string; options: readonly string[] } | null {
  const draft = post.draft;
  if (draft === null) return null;
  if (draft.kind === 'poll') return { text: draft.question, options: draft.options };
  return { text: draft.segments.map((segment) => segment.text).join(''), options: [] };
}

export interface WeekDay {
  readonly day: string;
  readonly weekday: string;
  readonly short: string;
  readonly number: number;
  readonly today: boolean;
  /** Every post of the day by hour, removed ones after their replacement's place. */
  readonly posts: readonly ChannelPlannedPost[];
  readonly waiting: number;
}

export interface WeekView {
  readonly title: string;
  readonly dates: string;
  /** The answer, said big: how many posts still wait for a read. */
  readonly waiting: number;
  readonly answer: string;
  /** Under the answer: until when, or that all is read. */
  readonly line: string;
  readonly reviewed: number;
  readonly total: number;
  readonly byKind: readonly { kind: ChannelPlannedKind; count: number }[];
  readonly days: readonly WeekDay[];
  /** The posts « Tout valider » validates: those that wait for a read. */
  readonly toValidate: readonly ChannelPlannedPost[];
}

export function weekView(week: ChannelWeek, now: Date, timeZone: string): WeekView {
  const today = dayIn(now, timeZone);
  const counted = week.posts.filter((post) => post.state !== 'removed');
  const toValidate = counted.filter((post) => waitsForRead(post, now));
  const waiting = toValidate.length;
  const next = toValidate[0];
  const days = Array.from({ length: 7 }, (_, index): WeekDay => {
    const day = addDays(week.week, index);
    const posts = week.posts
      .filter((post) => post.day === day)
      .sort(
        (a, b) =>
          a.at.localeCompare(b.at) || (a.state === 'removed' ? 1 : 0) - (b.state === 'removed' ? 1 : 0),
      );
    const weekday = WEEKDAYS[index] ?? '';
    return {
      day,
      weekday,
      short: weekday.slice(0, 3),
      number: dayNumber(day),
      today: day === today,
      posts,
      waiting: posts.filter((post) => post.state !== 'removed' && waitsForRead(post, now)).length,
    };
  });
  const answer =
    week.total === 0
      ? 'Pas encore planifiée'
      : waiting === 0
        ? 'Tout est relu'
        : `${String(waiting)} ${waiting === 1 ? 'post à relire' : 'posts à relire'}`;
  const line =
    week.total === 0
      ? 'La semaine se prépare le samedi à 18 h, une fois son canal branché.'
      : next === undefined
        ? 'Chaque post partira à son heure.'
        : `Le prochain part ${dayLabel(next.day, today)} à ${hourOf(next.at, timeZone)}. Sans relecture, il part quand même.`;
  return {
    title: 'La semaine du canal',
    dates: weekWords(week.week),
    waiting,
    answer,
    line,
    reviewed: week.reviewed,
    total: week.total,
    byKind: KINDS.map((kind) => ({ kind, count: counted.filter((post) => post.kind === kind).length })),
    days,
    toValidate,
  };
}

function dayLabel(day: string, today: string): string {
  if (day === today) return 'aujourd’hui';
  if (day === addDays(today, 1)) return 'demain';
  const index = (dayDate(day).getUTCDay() + 6) % 7;
  return `${WEEKDAYS[index] ?? ''} ${String(dayNumber(day))}`;
}
