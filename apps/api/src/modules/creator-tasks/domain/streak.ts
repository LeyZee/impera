import type { Tick } from './completion';

/**
 * Her streak (ADR 0042 § 3, Imperium's rules kept): a day is « réussie » when every essential task she accepted for
 * it is done, « parfaite » when every daily task is. The streak counts the « réussies » in a row, in her own zone;
 * one missed day is forgiven by the joker, a second breaks it. Pure: the days come already read in her zone
 * (`YYYY-MM-DD`), and the server alone computes it.
 */

/** What one of her days held and what she did of it, her routine and her accepted tasks together. */
export interface DayRecord {
  readonly day: string;
  /** Her essential tasks of that day (the agency's routine she accepted): how many, how many done. */
  readonly essentials: { readonly total: number; readonly done: number };
  /** Every daily task of that day, essential or not. */
  readonly daily: { readonly total: number; readonly done: number };
}

/**
 * `empty`: nothing essential that day, neither counted nor breaking. `missed`: an essential left undone. `success`:
 * every essential done. `perfect`: every daily task done too.
 */
export type DayOutcome = 'empty' | 'missed' | 'success' | 'perfect';

export function dayOutcome(record: DayRecord): DayOutcome {
  if (record.essentials.total === 0) return 'empty';
  if (record.essentials.done < record.essentials.total) return 'missed';
  return record.daily.total > 0 && record.daily.done >= record.daily.total ? 'perfect' : 'success';
}

/** One of her daily tasks due that day: the agency's routine she accepted is essential, her own is not (glossary). */
export interface DueTask {
  readonly taskId: string;
  readonly essential: boolean;
}

/** Her day from what was due and her ticks of that day (`applyTicks`: one per task and day). */
export function dayRecordOf(day: string, due: readonly DueTask[], ticks: readonly Tick[]): DayRecord {
  const done = new Set(ticks.filter((tick) => tick.day === day).map((tick) => tick.taskId));
  const essentials = due.filter((task) => task.essential);
  return {
    day,
    essentials: { total: essentials.length, done: essentials.filter((task) => done.has(task.taskId)).length },
    daily: { total: due.length, done: due.filter((task) => done.has(task.taskId)).length },
  };
}

/** The milestones a streak celebrates. */
const STREAK_MILESTONES = [7, 14, 30, 50, 100] as const;

export interface Streak {
  /** Days « réussies » in a row, today counted once it is. */
  readonly days: number;
  /** The joker forgave a missed day inside the run: the next one breaks it. */
  readonly jokerUsed: boolean;
  /** Today is not « réussie » yet, and the streak counts on it: what « série en danger » reads. */
  readonly atRisk: boolean;
  /** The last milestone reached, `null` under 7. */
  readonly milestone: (typeof STREAK_MILESTONES)[number] | null;
  /** The next milestone, `null` past 100. */
  readonly next: (typeof STREAK_MILESTONES)[number] | null;
}

/**
 * Her streak on `today`, from her days (any order, missing days are `empty`). Today never breaks it while it lasts:
 * an essential not done yet only puts it at risk. Walking back from yesterday, each « réussie » counts, an `empty`
 * day is passed over, the first `missed` one spends the joker and the second ends the run.
 */
export function streakOf(records: readonly DayRecord[], today: string): Streak {
  const outcomes = new Map(records.map((record) => [record.day, dayOutcome(record)]));
  const todayOutcome = outcomes.get(today) ?? 'empty';
  let days = todayOutcome === 'success' || todayOutcome === 'perfect' ? 1 : 0;
  let jokerUsed = false;
  // The joker counts as spent only if a « réussie » before it is saved: a missed day then a fresh start spends none.
  let savedByJoker = false;
  const past = [...outcomes.entries()].filter(([day]) => day < today).sort(([a], [b]) => (a < b ? 1 : -1));
  for (const [, outcome] of past) {
    if (outcome === 'success' || outcome === 'perfect') {
      days += 1;
      if (jokerUsed) savedByJoker = true;
    } else if (outcome === 'missed') {
      if (jokerUsed) break;
      jokerUsed = true;
    }
  }
  const milestone = [...STREAK_MILESTONES].reverse().find((step) => days >= step) ?? null;
  const next = STREAK_MILESTONES.find((step) => days < step) ?? null;
  return { days, jokerUsed: savedByJoker, atRisk: todayOutcome === 'missed' && days > 0, milestone, next };
}

/**
 * The longest streak her days held (ADR 0107 § 1): her streak as it stood at the end of each of them, the best kept.
 * Her medals follow it, so a medal reached stays reached when the streak falls back.
 */
export function bestStreakOf(records: readonly DayRecord[], today: string): number {
  let best = 0;
  for (const { day } of records) {
    if (day > today) continue;
    best = Math.max(
      best,
      streakOf(
        records.filter((record) => record.day <= day),
        day,
      ).days,
    );
  }
  return best;
}

/** One of her days was « parfaite » (ADR 0107 § 3, « Journée parfaite »). */
export const anyPerfectDay = (records: readonly DayRecord[]): boolean =>
  records.some((record) => dayOutcome(record) === 'perfect');
