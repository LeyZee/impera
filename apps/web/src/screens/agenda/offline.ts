import {
  CreatorAgendaSchema,
  CreatorTickSchema,
  type CreatorAgenda,
  type CreatorTick,
} from '@impera/contracts';
import { z } from 'zod';

/*
 * Her agenda off the network (ADR 0042 § 8): her last read of each range and the ticks her phone made while offline,
 * kept on this device under `impera.agenda.` and forgotten at sign-out with the rest of the device (`forgetDevice`).
 * Sales and money are never kept here: online only. A browser that refuses its storage keeps them for this tab.
 */

/** The prefix `forgetDevice` drops (`pwa/device.ts` keeps the same): everything of her agenda on this device. */
const AGENDA_STORAGE_PREFIX = 'impera.agenda.';

const SNAPSHOTS_KEY = `${AGENDA_STORAGE_PREFIX}snapshots`;
const PENDING_KEY = `${AGENDA_STORAGE_PREFIX}pending`;

/** A month and its edges, a week, a day: a few ranges are enough to open her agenda offline. */
const SNAPSHOTS_KEPT = 4;

/** `at`: when the server answered it, to say how old the copy shown is (CRE-02); absent in a copy kept before. */
const SnapshotsSchema = z.array(
  z.object({ range: z.string(), agenda: CreatorAgendaSchema, at: z.number().int().nonnegative().optional() }),
);

/** A tick or an untick made on her phone, sent when it is back online; the last gesture on a task and day wins. */
const PendingSchema = z.array(
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tick'), tick: CreatorTickSchema }),
    z.object({ kind: z.literal('untick'), taskId: z.string(), day: z.string() }),
  ]),
);
export type PendingGesture = z.infer<typeof PendingSchema>[number];

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
}

function parsed<T>(key: string, schema: z.ZodType<T>, empty: T): T {
  const raw = read(key);
  if (raw === null) return empty;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : empty;
  } catch {
    return empty;
  }
}

export const rangeKey = (from: string, to: string): string => `${from}/${to}`;

/** Her last read of a range, or `undefined` when this device never read it. */
export const snapshotOf = (range: string): CreatorAgenda | undefined =>
  parsed(SNAPSHOTS_KEY, SnapshotsSchema, []).find((snapshot) => snapshot.range === range)?.agenda;

/** When this device last read a range from the server (ms since 1970), or `undefined` when it does not know. */
export const snapshotAtOf = (range: string): number | undefined =>
  parsed(SNAPSHOTS_KEY, SnapshotsSchema, []).find((snapshot) => snapshot.range === range)?.at;

export function keepSnapshot(range: string, agenda: CreatorAgenda, at: number = Date.now()): void {
  const others = parsed(SNAPSHOTS_KEY, SnapshotsSchema, []).filter((snapshot) => snapshot.range !== range);
  write(SNAPSHOTS_KEY, JSON.stringify([{ range, agenda, at }, ...others].slice(0, SNAPSHOTS_KEPT)));
}

export const pendingGestures = (): PendingGesture[] => parsed(PENDING_KEY, PendingSchema, []);

const sameSpot = (gesture: PendingGesture, taskId: string, day: string): boolean =>
  gesture.kind === 'tick'
    ? gesture.tick.taskId === taskId && gesture.tick.day === day
    : gesture.taskId === taskId && gesture.day === day;

/** Keeps a gesture to send; an earlier one on the same task and day is replaced, as the last tap is what she meant. */
export function keepGesture(gesture: PendingGesture): void {
  const [taskId, day] =
    gesture.kind === 'tick' ? [gesture.tick.taskId, gesture.tick.day] : [gesture.taskId, gesture.day];
  write(
    PENDING_KEY,
    JSON.stringify([...pendingGestures().filter((known) => !sameSpot(known, taskId, day)), gesture]),
  );
}

/** Forgets the gestures sent (or refused for good), and only those: a tap made meanwhile stays. */
export function dropGestures(sent: readonly PendingGesture[]): void {
  const keys = new Set(sent.map((gesture) => JSON.stringify(gesture)));
  write(
    PENDING_KEY,
    JSON.stringify(pendingGestures().filter((gesture) => !keys.has(JSON.stringify(gesture)))),
  );
}

/** Her ticks as her screen shows them: the server's, with the gestures not sent yet applied over them. */
export function withPending(agenda: CreatorAgenda, pending: readonly PendingGesture[]): CreatorAgenda {
  let ticks: CreatorTick[] = [...agenda.ticks];
  for (const gesture of pending) {
    const [taskId, day] =
      gesture.kind === 'tick' ? [gesture.tick.taskId, gesture.tick.day] : [gesture.taskId, gesture.day];
    ticks = ticks.filter((tick) => tick.taskId !== taskId || tick.day !== day);
    if (gesture.kind === 'tick') ticks.push(gesture.tick);
  }
  return { ...agenda, ticks };
}
