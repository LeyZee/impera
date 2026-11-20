import type { CreatorWeek, DeliveryLine, HerShootDay, WeekNeed } from '@impera/contracts';

import { clockAt, dayOf, longDay } from '@/scheduling/time';

/** What each line of her delivery is, in her words (plural: « 2 / 3 »). */
export const NEED_WORDS: Readonly<Record<WeekNeed, string>> = {
  script: 'Scripts',
  feed_shoot: 'Séances feed',
  feed_video: 'Vidéos feed',
  mass_dm: 'Relance',
  idea: 'Idées',
  reveal_story: 'Stories',
};

/** Whether her week has anything to show: the agency sent it. */
export const hasWeek = (week: CreatorWeek): boolean => week.shootDays.length > 0 || week.delivery !== null;

/** « 2 / 3 » of a shooting day: the lines shot, of all. */
export function progressOf(day: HerShootDay): { readonly done: number; readonly total: number } {
  return { done: day.items.filter((item) => item.done).length, total: day.items.length };
}

/** « À livrer avant dimanche 29 novembre, 23 h »: her deadline in her zone. */
export function dueWords(dueAt: string, zone: string): string {
  return `À livrer avant ${longDay(dayOf(dueAt, zone))}, ${clockAt(dueAt, zone)}`;
}

/** What is left to drop, line by line, for « Livrer ma semaine »; empty once everything arrived. */
export const leftToDrop = (lines: readonly DeliveryLine[]): readonly DeliveryLine[] =>
  lines.filter((line) => line.received < line.asked);
