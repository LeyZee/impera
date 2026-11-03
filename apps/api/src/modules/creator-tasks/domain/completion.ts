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
