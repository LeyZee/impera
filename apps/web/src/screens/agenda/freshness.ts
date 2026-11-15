import { addDays, clockAt, dayOf, longDay } from '@/scheduling/time';

/*
 * How fresh the agenda on her screen is (CRE-02): her phone shows its last read at once, then reads again. A copy is
 * never passed off as the day's truth: it says it is being updated, and, when the read fails, why, and how old it is.
 * « Hors ligne » only when the browser says so; a server that fails while she has a network is « Le serveur ne répond
 * pas ».
 */

export type Freshness =
  /** What the server last said, read in this session: nothing to say. */
  | { readonly kind: 'fresh' }
  /** Her kept copy, while the server is being asked. */
  | { readonly kind: 'updating' }
  /** No network: her last read, which stays until the network comes back. */
  | { readonly kind: 'offline'; readonly readAt: number | null }
  /** A network, but the server failed: her last read, and « Réessayer ». */
  | { readonly kind: 'silent'; readonly readAt: number | null };

export interface ReadState {
  /** An agenda is on the screen. */
  readonly shown: boolean;
  /** What the browser says of the network. */
  readonly online: boolean;
  readonly isError: boolean;
  readonly isFetching: boolean;
  /** The read waits for the network (`fetchStatus === 'paused'`). */
  readonly paused: boolean;
  /** When the agenda shown was read in this session; 0 for the copy kept on the phone. */
  readonly dataUpdatedAt: number;
  /** When this device last read the range from the server, if it knows. */
  readonly keptAt: number | undefined;
}

export function freshnessOf(state: ReadState): Freshness {
  if (!state.shown) return { kind: 'fresh' };
  const readAt = state.keptAt ?? (state.dataUpdatedAt > 0 ? state.dataUpdatedAt : null);
  if (!state.online || state.paused) return { kind: 'offline', readAt };
  if (state.isError) return { kind: 'silent', readAt };
  if (state.isFetching && state.dataUpdatedAt === 0) return { kind: 'updating' };
  return { kind: 'fresh' };
}

/** « aujourd’hui à 8 h 05 », « hier à 21 h », « le jeudi 5 novembre à 9 h »: when her copy was read, in her zone. */
export function readAtWords(at: number, zone: string, today: string): string {
  const instant = new Date(at);
  const day = dayOf(instant, zone);
  const clock = clockAt(instant, zone);
  if (day === today) return `aujourd’hui à ${clock}`;
  if (day === addDays(today, -1)) return `hier à ${clock}`;
  return `le ${longDay(day)} à ${clock}`;
}
