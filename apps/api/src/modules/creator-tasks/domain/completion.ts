import { calendarDayIn } from '../../scheduling/pure';

/**
 * Her ticks (ADR 0042 § 8): a task is done once on a given day, whatever the number of taps or of replays from her
 * phone back online. A tick is named by its task and its day, never by when it reached the server.
 */
export interface Tick {
  readonly taskId: string;
  /** Her day the tick is for, `YYYY-MM-DD`: a routine task is ticked each day, a dated task on its own day. */
  readonly day: string;
  /** When she ticked, on her phone: the first one stays. */
  readonly doneAt: Date;
}

const keyOf = (tick: Pick<Tick, 'taskId' | 'day'>): string => `${tick.taskId}/${tick.day}`;

/**
 * Her ticks once the incoming ones are applied, any number of times and in any order: one per task and day. A tick
 * already there stays as it is; of new ticks for the same task and day, the earliest `doneAt` is kept, so a replay in
 * another order gives the same result. `added` lists what was not there.
 */
export function applyTicks(
  existing: readonly Tick[],
  incoming: readonly Tick[],
): { ticks: Tick[]; added: Tick[] } {
  const known = new Set(existing.map(keyOf));
  const added = new Map<string, Tick>();
  for (const tick of incoming) {
    const key = keyOf(tick);
    if (known.has(key)) continue;
    const earlier = added.get(key);
    if (earlier === undefined || tick.doneAt < earlier.doneAt) added.set(key, tick);
  }
  return { ticks: [...existing, ...added.values()], added: [...added.values()] };
}

/** How old a tick may be when it reaches the server, kept offline on her phone (ADR 0042 § 8). */
const TICK_MAX_AGE_HOURS = 48;

/** How far ahead of the server's clock her phone's may be. */
const TICK_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Whether a tick may count (ADR 0042 § 8): made at most 48 h before it arrives and not later than now, give or take her
 * phone's clock. A routine tick is for the day she ticked it in her zone, the server's reading of it, never another:
 * her streak is not mended afterwards. A dated task may be ticked ahead or late within the 48 h, on its own day.
 */
export function tickTimely(tick: Tick, routine: boolean, now: Date, timeZone: string): boolean {
  const age = now.getTime() - tick.doneAt.getTime();
  if (age > TICK_MAX_AGE_HOURS * 3_600_000 || age < -TICK_CLOCK_SKEW_MS) return false;
  return !routine || calendarDayIn(tick.doneAt, timeZone) === tick.day;
}
