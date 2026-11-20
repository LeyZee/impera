import type { CreatorWeek, DeliveryLine, HerShootDay, WeekNeed } from '@impera/contracts';

import { addDays, clockAt, daysFrom, dayOf, longDay, shortDay } from '@/scheduling/time';

/** What each line of her delivery is, in her words (plural: « 1 sur 3 »). */
export const NEED_WORDS: Readonly<Record<WeekNeed, string>> = {
  script: 'Scripts',
  feed_shoot: 'Séances boudoir',
  feed_video: 'Vidéos du jour',
  mass_dm: 'Pour les Mass DM',
  idea: 'Idées',
  reveal_story: 'Stories',
};

/** The day her eyes go to first: today's or the next shooting day not done; else the last one. */
export function nextDay(days: readonly HerShootDay[], today: string): HerShootDay | null {
  const ahead = days.filter((day) => day.day >= today);
  const open = days.find((day) => day.items.some((item) => !item.done));
  return ahead.find((day) => day.items.some((item) => !item.done)) ?? ahead[0] ?? open ?? days.at(-1) ?? null;
}

/** Whether her week has anything to show: the agency sent it. */
export const hasWeek = (week: CreatorWeek): boolean => week.shootDays.length > 0 || week.delivery !== null;

/** « 2 / 3 » of a shooting day: the lines shot, of all. */
export function progressOf(day: HerShootDay): { readonly done: number; readonly total: number } {
  return { done: day.items.filter((item) => item.done).length, total: day.items.length };
}

/** Every line of her shooting days, shot or not: the first step of her week. */
export function shotOf(days: readonly HerShootDay[]): { readonly done: number; readonly total: number } {
  return days.reduce(
    (sum, day) => {
      const { done, total } = progressOf(day);
      return { done: sum.done + done, total: sum.total + total };
    },
    { done: 0, total: 0 },
  );
}

/** Everything her week asks her to drop, and what arrived: the second step. */
export function droppedOf(lines: readonly DeliveryLine[]): { readonly done: number; readonly total: number } {
  return lines.reduce(
    (sum, line) => ({ done: sum.done + Math.min(line.received, line.asked), total: sum.total + line.asked }),
    { done: 0, total: 0 },
  );
}

/** « mer. 25 et sam. 28 »: her shooting days, short, in one glance. */
export function shootDaysWords(days: readonly HerShootDay[]): string {
  const words = days.map((day) => shortDay(day.day));
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} et ${words.at(-1) ?? ''}`;
}

/** « Aujourd’hui », « Demain », « Dans 3 jours », « Passé »: how far her shooting day is. */
export function dayWhen(day: string, today: string): string {
  const days = daysFrom(today, day);
  if (days === 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  if (days < 0) return 'Passé';
  return `Dans ${String(days)} jours`;
}

/** « dim. 29, 23 h »: her deadline, short, in her zone. */
export const dueShort = (dueAt: string, zone: string): string =>
  `${shortDay(dayOf(dueAt, zone))}, ${clockAt(dueAt, zone)}`;

/** « ce soir », « demain soir », « dans 6 jours », « passé »: how long she has left. */
export function dueIn(dueAt: string, zone: string, today: string, now: number = Date.now()): string {
  if (Date.parse(dueAt) <= now) return 'passé';
  const due = dayOf(dueAt, zone);
  if (due === today) return 'ce soir';
  if (due === addDays(today, 1)) return 'demain soir';
  return `dans ${String(daysFrom(today, due))} jours`;
}

/** « À livrer avant dimanche 29 novembre, 23 h »: her deadline in her zone. */
export function dueWords(dueAt: string, zone: string): string {
  return `À livrer avant ${longDay(dayOf(dueAt, zone))}, ${clockAt(dueAt, zone)}`;
}

/** What is left to drop, line by line, for « Livrer ma semaine »; empty once everything arrived. */
export const leftToDrop = (lines: readonly DeliveryLine[]): readonly DeliveryLine[] =>
  lines.filter((line) => line.received < line.asked);
