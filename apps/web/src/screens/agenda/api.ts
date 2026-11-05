import {
  ApiErrorSchema,
  AvailabilitySchema,
  CreatorAgendaSchema,
  CreatorTaskSchema,
  type AcceptSuggestionBody,
  type AvailabilityView,
  type CreateAvailabilityBody,
  type CreateCreatorTaskBody,
  type CreatorAgenda,
  type CreatorTask,
  type CreatorTaskWhen,
  type DeclineSuggestionBody,
  type UpdateCreatorTaskBody,
} from '@impera/contracts';
import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { z } from 'zod';

import {
  dropGestures,
  keepGesture,
  keepSnapshot,
  pendingGestures,
  rangeKey,
  snapshotOf,
  withPending,
  type PendingGesture,
} from './offline';

/*
 * Her agenda's doors (CR-05, `/v1/creator-space`), parsed with the `strict` contracts: a field the server would add by
 * mistake (where a suggestion came from) fails here instead of reaching her screen. Reading and ticking work offline
 * (ADR 0042 § 8); everything else waits for the network and says so.
 */

const BASE = '/v1/creator-space';
const JSON_HEADERS = { 'content-type': 'application/json' };
export const AGENDA_KEY = ['creator-space', 'agenda'] as const;

/** A read that never reached the server: her phone is offline, or the server is silent. */
class Unreachable extends Error {}

/** `GET /v1/creator-space/agenda`: from the network, kept for offline; offline, her last read of the same range. */
export function useAgenda(from: string, to: string): UseQueryResult<CreatorAgenda> {
  const range = rangeKey(from, to);
  return useQuery({
    queryKey: [...AGENDA_KEY, from, to],
    queryFn: async () => {
      let response: Response;
      try {
        response = await fetch(`${BASE}/agenda?${new URLSearchParams({ from, to }).toString()}`, {
          credentials: 'include',
        });
      } catch {
        const kept = snapshotOf(range);
        if (kept !== undefined) return kept;
        throw new Unreachable(`GET ${BASE}/agenda: offline`);
      }
      if (!response.ok) throw new Error(`GET ${BASE}/agenda: ${String(response.status)}`);
      const agenda = CreatorAgendaSchema.parse(await response.json());
      keepSnapshot(range, agenda);
      return agenda;
    },
    // Her last read shows at once, offline too, and is read again as soon as the network answers.
    initialData: () => snapshotOf(range),
    initialDataUpdatedAt: 0,
    networkMode: 'offlineFirst',
    refetchInterval: 60_000,
    retry: 1,
    retryDelay: 400,
  });
}

/* ---- The gestures her phone keeps until they are sent ---- */

const listeners = new Set<() => void>();
let pending: readonly PendingGesture[] = pendingGestures();

function changed(): void {
  pending = pendingGestures();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Her agenda with the ticks she made and that are not sent yet. */
export function useWithPending(agenda: CreatorAgenda | undefined): {
  readonly agenda: CreatorAgenda | undefined;
  readonly waiting: number;
} {
  const gestures = useSyncExternalStore(subscribe, () => pending);
  return {
    agenda: agenda === undefined ? undefined : withPending(agenda, gestures),
    waiting: gestures.length,
  };
}

/**
 * What a send of her gestures ended with: how many the server will never take (a task removed, a tick too late), and
 * whether her session had expired (her gestures then wait for her to sign in again: nothing is lost).
 */
export interface Flushed {
  readonly refused: number;
  readonly expired: boolean;
}

/** A refusal of the gesture itself, never to retry: anything else (session, rate limit, server, network) is retried. */
const REFUSALS = new Set([400, 404, 409, 422]);

/** The tasks a refusal of `POST /ticks` names (`details.taskIds`): the batch is refused as a whole, they alone are why. */
async function namedTasks(response: Response): Promise<ReadonlySet<string> | null> {
  const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!refusal.success) return null;
  const ids = z.array(z.string()).safeParse(refusal.data.error.details['taskIds']);
  return ids.success && ids.data.length > 0 ? new Set(ids.data) : null;
}

/** The longest chain of refusals a batch meets: a removed task, then a day off, then a tick too late. */
const TICK_ATTEMPTS = 4;

async function sendGestures(): Promise<Flushed & { readonly answered: boolean }> {
  const gestures = pendingGestures();
  if (gestures.length === 0) return { refused: 0, expired: false, answered: false };
  let refused = 0;
  let expired = false;
  let answered = false;
  const done: PendingGesture[] = [];
  const note = (status: number): void => {
    answered = true;
    if (status === 401) expired = true;
  };
  try {
    let ticks = gestures.filter((gesture) => gesture.kind === 'tick');
    for (let attempt = 0; ticks.length > 0 && attempt < TICK_ATTEMPTS; attempt += 1) {
      const response = await fetch(`${BASE}/ticks`, {
        method: 'POST',
        credentials: 'include',
        headers: JSON_HEADERS,
        body: JSON.stringify({ ticks: ticks.map((gesture) => gesture.tick) }),
      });
      note(response.status);
      if (response.ok) {
        done.push(...ticks);
        break;
      }
      if (!REFUSALS.has(response.status)) break;
      // The batch is refused as a whole: only the ticks it names are forgotten, the others go again.
      const named = await namedTasks(response);
      const bad = named === null ? ticks : ticks.filter((gesture) => named.has(gesture.tick.taskId));
      done.push(...bad);
      refused += bad.length;
      ticks = ticks.filter((gesture) => !bad.includes(gesture));
    }
    for (const gesture of gestures) {
      if (gesture.kind !== 'untick') continue;
      const response = await fetch(`${BASE}/tasks/${gesture.taskId}/ticks/${gesture.day}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      note(response.status);
      // 404: the tick or the task is gone already, which is what she wanted.
      if (response.ok || response.status === 404) done.push(gesture);
      else if (REFUSALS.has(response.status)) {
        done.push(gesture);
        refused += 1;
      }
    }
  } finally {
    // What got an answer is settled even when the network drops halfway.
    dropGestures(done);
  }
  return { refused, expired, answered };
}

let flushing: Promise<Flushed> | null = null;
/** A gesture kept while a send was running: it was not in the list that send read, so one more send follows. */
let keptDuringSend = false;
/** Read through a call: `tickTask` sets it between the awaits of a send. */
const keptMeanwhile = (): boolean => keptDuringSend;

async function sendAll(): Promise<Flushed> {
  let refused = 0;
  let expired = false;
  for (;;) {
    keptDuringSend = false;
    const result = await sendGestures().catch(() => ({ refused: 0, expired: false, answered: false }));
    refused += result.refused;
    expired ||= result.expired;
    // Again only when the server answered (online) and a tap came meanwhile; offline, it waits for `online`.
    if (!result.answered || result.expired || !keptMeanwhile()) return { refused, expired };
  }
}

/** Sends what her phone kept, once at a time; offline, it all stays for the next try. */
export function flushGestures(client: QueryClient): Promise<Flushed> {
  flushing ??= sendAll()
    .then(async (result) => {
      changed();
      await client.invalidateQueries({ queryKey: AGENDA_KEY });
      return result;
    })
    .finally(() => {
      flushing = null;
    });
  return flushing;
}

/** Ticks or unticks a task on a day: shown at once, kept on the phone, sent now or when the network comes back. */
export function tickTask(client: QueryClient, task: CreatorTask, day: string, on: boolean): Promise<Flushed> {
  keepGesture(
    on
      ? { kind: 'tick', tick: { taskId: task.id, day, doneAt: new Date().toISOString() } }
      : { kind: 'untick', taskId: task.id, day },
  );
  if (flushing !== null) keptDuringSend = true;
  changed();
  return flushGestures(client);
}

/** Sends her kept gestures when the screen opens and each time the network comes back. */
export function useFlushOnReconnect(onSent: (flushed: Flushed) => void): void {
  const client = useQueryClient();
  useEffect(() => {
    const flush = (): void => {
      void flushGestures(client).then(onSent);
    };
    flush();
    addEventListener('online', flush);
    return () => {
      removeEventListener('online', flush);
    };
  }, [client, onSent]);
}

/* ---- What needs the network ---- */

export type Outcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'refused'; readonly code: string }
  /** The request never reached the server: nothing was sent, and nothing waits to be (recette 05/11, CREA-06). */
  | { readonly kind: 'offline' }
  /** The server answered, with an error of its own (5xx) or an answer that cannot be read. */
  | { readonly kind: 'failed' };

/** What a change that did not go through says: never « no network » for a server error, never a promise to send later. */
export const NOT_SENT: Readonly<Record<'offline' | 'failed', string>> = {
  offline: 'Pas de réseau : rien n’est parti. Réessaie quand tu es en ligne.',
  failed: 'Ça n’a pas marché de notre côté. Réessaie dans un moment.',
};

async function send<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body: unknown,
  parse: (json: unknown) => T,
): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) }),
    });
  } catch {
    return { kind: 'offline' };
  }
  try {
    if (response.status >= 500) return { kind: 'failed' };
    if (!response.ok) {
      const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
      return refusal.success ? { kind: 'refused', code: refusal.data.error.code } : { kind: 'failed' };
    }
    return { kind: 'ok', value: parse(response.status === 204 ? null : await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

export const createTask = (body: CreateCreatorTaskBody): Promise<Outcome<CreatorTask>> =>
  send('POST', `${BASE}/tasks`, body, (json) => CreatorTaskSchema.parse(json));

/** Moves a task (a drag in Semaine, « Changer le moment »): online only, like every change but a tick. */
export const updateTask = (taskId: string, body: UpdateCreatorTaskBody): Promise<Outcome<CreatorTask>> =>
  send('PATCH', `${BASE}/tasks/${taskId}`, body, (json) => CreatorTaskSchema.parse(json));

/**
 * Moves a task where her drag left it: shown there at once, then sent. `false` when the server did not take it (no
 * network, the task changed): her agenda is read again and the task goes back where it is.
 */
export async function moveTask(
  client: QueryClient,
  task: CreatorTask,
  when: CreatorTaskWhen,
): Promise<boolean> {
  await client.cancelQueries({ queryKey: AGENDA_KEY });
  client.setQueriesData<CreatorAgenda>({ queryKey: AGENDA_KEY }, (agenda) =>
    agenda === undefined
      ? agenda
      : { ...agenda, tasks: agenda.tasks.map((one) => (one.id === task.id ? { ...one, when } : one)) },
  );
  const outcome = await updateTask(task.id, { when });
  await client.invalidateQueries({ queryKey: AGENDA_KEY });
  return outcome.kind === 'ok';
}

export const archiveTask = (taskId: string): Promise<Outcome<null>> =>
  send('DELETE', `${BASE}/tasks/${taskId}`, undefined, () => null);

export const createAvailability = (body: CreateAvailabilityBody): Promise<Outcome<AvailabilityView>> =>
  send('POST', `${BASE}/availabilities`, body, (json) => AvailabilitySchema.parse(json));

export const archiveAvailability = (availabilityId: string): Promise<Outcome<null>> =>
  send('DELETE', `${BASE}/availabilities/${availabilityId}`, undefined, () => null);

export const acceptSuggestion = (
  suggestionId: string,
  body: AcceptSuggestionBody,
): Promise<Outcome<CreatorTask>> =>
  send('POST', `${BASE}/suggestions/${suggestionId}/accept`, body, (json) => CreatorTaskSchema.parse(json));

export const declineSuggestion = (
  suggestionId: string,
  body: DeclineSuggestionBody,
): Promise<Outcome<null>> => send('POST', `${BASE}/suggestions/${suggestionId}/decline`, body, () => null);
