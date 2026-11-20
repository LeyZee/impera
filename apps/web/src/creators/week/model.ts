import { SHOOT_DAYS_MAX, type WeekPlan, type WeekPlanDay } from '@impera/contracts';

import { addDays } from '@/scheduling/time';

/*
 * The owner's corrections of a week the code proposed (ADR 0140 § 3): a shooting day moved, a line moved to another day
 * or to the week after, a day added or taken off. Each one answers a new plan; the server checks it again on « Valider ».
 */

/** What a shooting day holds as the agency counts it, in minutes. */
export const loadOf = (day: WeekPlanDay): number => day.items.reduce((sum, item) => sum + item.minutes, 0);

/** Over what one shooting day holds: shown amber, never refused (the owner knows her). */
export const overloaded = (day: WeekPlanDay, plan: WeekPlan): boolean => loadOf(day) > plan.capacityMinutes;

const byDay = (days: readonly WeekPlanDay[]): WeekPlanDay[] =>
  [...days].sort((one, other) => one.day.localeCompare(other.day));

/** The days of the week no shooting day takes yet, `but` excepted (the one being moved keeps its own). */
export function freeDays(plan: WeekPlan, monday: string, but: string | null = null): readonly string[] {
  const taken = new Set(plan.shootDays.map((day) => day.day).filter((day) => day !== but));
  return Array.from({ length: 7 }, (_, offset) => addDays(monday, offset)).filter((day) => !taken.has(day));
}

/** A shooting day moved to another day of the week, its lines with it. */
export function moveDay(plan: WeekPlan, from: string, to: string): WeekPlan {
  if (from === to || plan.shootDays.some((day) => day.day === to)) return plan;
  return {
    ...plan,
    shootDays: byDay(plan.shootDays.map((day) => (day.day === from ? { ...day, day: to } : day))),
  };
}

/** Where a line goes: another shooting day, or the week after (`deferred`). */
export type LineTarget = { readonly day: string } | 'deferred';

/** A line of a shooting day moved to another one, or to the week after. */
export function moveLine(plan: WeekPlan, from: string, index: number, to: LineTarget): WeekPlan {
  const source = plan.shootDays.find((day) => day.day === from);
  const line = source?.items[index];
  if (line === undefined) return plan;
  if (to !== 'deferred' && to.day === from) return plan;
  const shootDays = plan.shootDays.map((day) => {
    if (day.day === from) return { ...day, items: day.items.filter((_, at) => at !== index) };
    if (to !== 'deferred' && day.day === to.day) return { ...day, items: [...day.items, line] };
    return day;
  });
  return { ...plan, shootDays, deferred: to === 'deferred' ? [line, ...plan.deferred] : plan.deferred };
}

/** A line put back from the week after onto the shooting day with the most room left. */
export function restoreLine(plan: WeekPlan, index: number): WeekPlan {
  const line = plan.deferred[index];
  if (line === undefined || plan.shootDays.length === 0) return plan;
  const roomiest = plan.shootDays.reduce((best, day) => (loadOf(day) < loadOf(best) ? day : best));
  return {
    ...plan,
    shootDays: plan.shootDays.map((day) =>
      day.day === roomiest.day ? { ...day, items: [...day.items, line] } : day,
    ),
    deferred: plan.deferred.filter((_, at) => at !== index),
  };
}

/** One more shooting day, on the first free day of the week from Wednesday; none past the most a week holds. */
export function addShootDay(plan: WeekPlan, monday: string): WeekPlan {
  if (plan.shootDays.length >= SHOOT_DAYS_MAX) return plan;
  const free = freeDays(plan, monday);
  const day = free.find((one) => one >= addDays(monday, 2)) ?? free[0];
  if (day === undefined) return plan;
  return { ...plan, shootDays: byDay([...plan.shootDays, { day, items: [] }]) };
}

/** A shooting day taken off: its lines go to the week after, where the owner may put them back. The last one stays. */
export function removeShootDay(plan: WeekPlan, which: string): WeekPlan {
  const gone = plan.shootDays.find((day) => day.day === which);
  if (gone === undefined || plan.shootDays.length <= 1) return plan;
  return {
    ...plan,
    shootDays: plan.shootDays.filter((day) => day.day !== which),
    deferred: [...gone.items, ...plan.deferred],
  };
}
