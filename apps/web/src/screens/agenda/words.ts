import type { CreatorTaskWhen } from '@impera/contracts';

import { clockAt, dayOf, longDay } from '@/scheduling/time';

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** « chaque lundi et jeudi », « chaque jour »: her routine's days. */
function routineWords(weekdays: readonly number[]): string {
  if (weekdays.length === 7) return 'Chaque jour';
  const names = [...weekdays].sort((a, b) => a - b).map((weekday) => WEEKDAYS[weekday - 1] ?? '');
  const last = names.at(-1) ?? '';
  return `Chaque ${names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${last}` : last}`;
}

/** When a task or a suggestion is, in her words and her zone: « mercredi 4 novembre, 14 h – 15 h ». */
export function whenWords(when: CreatorTaskWhen, zone: string): string {
  if (when.kind === 'day') return longDay(when.day);
  if (when.kind === 'routine') return routineWords(when.weekdays);
  return `${longDay(dayOf(when.startsAt, zone))}, ${clockAt(when.startsAt, zone)} – ${clockAt(when.endsAt, zone)}`;
}
