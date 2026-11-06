import {
  CreatorIdSchema,
  TREND_READINGS_BATCH_MAX,
  TrendReadingInputSchema,
  WatchSessionIdSchema,
  type CreatorId,
  type TrendReadingInput,
  type TrendReadingsBatch,
  type WatchSessionId,
} from '@impera/contracts';
import { z } from 'zod';

import type { SeenPost } from './protocol';

/**
 * The service worker's memory of the watches (VEI-02), kept in `chrome.storage.session` because the worker itself is
 * thrown away between events: which tab watches since when, the posts waiting to be sent, the marks. Session storage
 * lives in memory only and is gone when the browser closes, like a watch.
 */

/** A watch stops by itself after this long (ADR 0060 § 2). */
export const WATCH_DURATION_MS = 45 * 60_000;
/** Posts waiting past this many (the server unreachable for long) are dropped, the oldest first. */
const PENDING_MAX = 500;

const TabWatchSchema = z.strictObject({
  session: WatchSessionIdSchema,
  startedAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  posts: z.number().int().min(0),
  marked: z.number().int().min(0),
  amber: z.boolean(),
});
export type TabWatch = z.infer<typeof TabWatchSchema>;

const WatchStateSchema = z.strictObject({
  /** By tab id, as a string. */
  watches: z.record(z.string(), TabWatchSchema),
  /** The readings to send, by session then post code: the last state of each post. */
  pending: z.record(z.string(), z.record(z.string(), TrendReadingInputSchema)),
  /** The posts marked in each session, by code: a later reading of the post keeps its mark. */
  marks: z.record(z.string(), z.record(z.string(), CreatorIdSchema)),
  /** Watches just ended, by tab: the reader's last posts, sent as it stops, still land in their session. */
  ended: z.record(z.string(), z.strictObject({ session: WatchSessionIdSchema, at: z.iso.datetime() })),
  vision: z.enum(['described', 'budget', 'unavailable', 'failed']).nullable(),
  lastCreatorId: CreatorIdSchema.nullable(),
});
export type WatchState = z.infer<typeof WatchStateSchema>;

export const EMPTY_STATE: WatchState = {
  watches: {},
  pending: {},
  marks: {},
  ended: {},
  vision: null,
  lastCreatorId: null,
};

/** How long the last posts of an ended watch are still taken. */
const ENDED_GRACE_MS = 60_000;

function without<T>(record: Readonly<Record<string, T>>, tabId: number): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== String(tabId)));
}

export function parseState(raw: unknown): WatchState {
  const parsed = WatchStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : structuredClone(EMPTY_STATE);
}

export function begin(state: WatchState, tabId: number, session: WatchSessionId, now: Date): WatchState {
  const watches = { ...state.watches };
  watches[String(tabId)] = {
    session,
    startedAt: now.toISOString(),
    endsAt: new Date(now.getTime() + WATCH_DURATION_MS).toISOString(),
    posts: 0,
    marked: 0,
    amber: false,
  };
  return { ...state, watches, ended: without(state.ended, tabId) };
}

/** Ends a tab's watch; its readings stay pending until sent, and its reader's last posts are still taken a minute. */
export function end(state: WatchState, tabId: number, now: Date): WatchState {
  const watch = watchOf(state, tabId);
  if (watch === null) return state;
  const ended = { ...state.ended, [String(tabId)]: { session: watch.session, at: now.toISOString() } };
  return { ...state, watches: without(state.watches, tabId), ended };
}

/** Forgets ended watches past their minute, and the marks of sessions with nothing left to send. */
export function prune(state: WatchState, now: Date): WatchState {
  const ended = Object.fromEntries(
    Object.entries(state.ended).filter(([, entry]) => now.getTime() - Date.parse(entry.at) < ENDED_GRACE_MS),
  );
  const live = new Set([
    ...Object.values(state.watches).map((watch) => watch.session),
    ...Object.values(ended).map((entry) => entry.session),
    ...Object.keys(state.pending),
  ]);
  const marks = Object.fromEntries(Object.entries(state.marks).filter(([session]) => live.has(session)));
  return { ...state, ended, marks };
}

export function watchOf(state: WatchState, tabId: number): TabWatch | null {
  return state.watches[String(tabId)] ?? null;
}

/** The tabs whose watch has run its 45 minutes. */
export function expired(state: WatchState, now: Date): readonly number[] {
  return Object.entries(state.watches)
    .filter(([, watch]) => Date.parse(watch.endsAt) <= now.getTime())
    .map(([tabId]) => Number(tabId));
}

function readingOf(post: SeenPost, markedFor: CreatorId | null): TrendReadingInput {
  return { ...post, hashtags: [...post.hashtags], markedFor };
}

/** Posts the reader of a watched tab saw: each replaces its waiting reading, keeping its mark. */
export function addSeen(state: WatchState, tabId: number, posts: readonly SeenPost[]): WatchState {
  const watch = watchOf(state, tabId);
  const session = watch?.session ?? state.ended[String(tabId)]?.session;
  if (session === undefined) return state;
  const marks = state.marks[session] ?? {};
  const waiting = { ...(state.pending[session] ?? {}) };
  const known = new Set(Object.keys(waiting));
  let fresh = 0;
  for (const post of posts) {
    if (!known.has(post.code)) fresh += 1;
    waiting[post.code] = readingOf(post, marks[post.code] ?? null);
  }
  const pending = trim({ ...state.pending, [session]: waiting });
  if (watch === null) return { ...state, pending };
  const watches = { ...state.watches, [String(tabId)]: { ...watch, posts: watch.posts + fresh } };
  return { ...state, watches, pending };
}

/** Marks a post of a watched tab for a creator: it is sent again, marked, with the next batch. */
export function mark(state: WatchState, tabId: number, post: SeenPost, creatorId: CreatorId): WatchState {
  const watch = watchOf(state, tabId);
  if (watch === null) return state;
  const marks = {
    ...state.marks,
    [watch.session]: { ...(state.marks[watch.session] ?? {}), [post.code]: creatorId },
  };
  const waiting = { ...(state.pending[watch.session] ?? {}), [post.code]: readingOf(post, creatorId) };
  const firstMark = state.marks[watch.session]?.[post.code] === undefined;
  return {
    ...state,
    marks,
    pending: { ...state.pending, [watch.session]: waiting },
    watches: { ...state.watches, [String(tabId)]: { ...watch, marked: watch.marked + (firstMark ? 1 : 0) } },
    lastCreatorId: creatorId,
  };
}

/** The waiting readings as batches the API takes, and the state without them. */
export function takeBatches(state: WatchState): { batches: readonly TrendReadingsBatch[]; rest: WatchState } {
  const batches: TrendReadingsBatch[] = [];
  for (const [session, waiting] of Object.entries(state.pending)) {
    const readings = Object.values(waiting);
    const watchSession = WatchSessionIdSchema.parse(session);
    for (let start = 0; start < readings.length; start += TREND_READINGS_BATCH_MAX) {
      batches.push({ watchSession, readings: readings.slice(start, start + TREND_READINGS_BATCH_MAX) });
    }
  }
  return { batches, rest: { ...state, pending: {} } };
}

/** Puts back batches that could not be sent; a reading seen again meanwhile wins over the one put back. */
export function putBack(state: WatchState, batches: readonly TrendReadingsBatch[]): WatchState {
  const pending = { ...state.pending };
  for (const batch of batches) {
    const waiting = { ...(pending[batch.watchSession] ?? {}) };
    for (const reading of batch.readings) waiting[reading.code] ??= reading;
    pending[batch.watchSession] = waiting;
  }
  return { ...state, pending: trim(pending) };
}

function trim(pending: WatchState['pending']): WatchState['pending'] {
  let total = Object.values(pending).reduce((sum, waiting) => sum + Object.keys(waiting).length, 0);
  if (total <= PENDING_MAX) return pending;
  const out: WatchState['pending'] = {};
  for (const [session, waiting] of Object.entries(pending)) {
    const entries = Object.entries(waiting).sort(
      ([, a], [, b]) => Date.parse(a.seenAt) - Date.parse(b.seenAt),
    );
    while (total > PENDING_MAX && entries.length > 0 && entries[0]?.[1].markedFor === null) {
      entries.shift();
      total -= 1;
    }
    out[session] = Object.fromEntries(entries);
  }
  return out;
}
