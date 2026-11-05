import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { LlmPurpose } from '@impera/contracts';

import { startOfLocalDay } from './budget';
import type { LlmRole, ProviderId } from './config';

export const CALL_OUTCOMES = [
  'ok',
  'invalid_output',
  'refused',
  'timeout',
  'rate_limited',
  'auth',
  'unavailable',
  'missing_key',
  'unknown_model',
  'unsupported_input',
  'prompt_leak',
  'error',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** One provider call. Never holds prompt or message content: only what supervision and costs need. */
export interface LlmCallRecord {
  readonly at: Date;
  readonly role: LlmRole;
  readonly provider: ProviderId;
  readonly model: string;
  readonly promptHash: string;
  readonly outcome: CallOutcome;
  readonly latencyMs: number;
  readonly isFallback: boolean;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly costUsd?: number;
  readonly errorMessage?: string;
  /** Who paid for it: the real cost per creator, conversation and draft (llm_calls). */
  readonly creatorId?: string;
  readonly conversationId?: string;
  readonly draftId?: string;
  /** What it was for (ADR 0060 § 7); absent is `chatting`. */
  readonly purpose?: LlmPurpose;
}

/** Journal of calls; the llm_calls table implements it once the database exists (P0-03). */
export interface LlmCallLog {
  append(record: LlmCallRecord): void;
  since(from: Date): readonly LlmCallRecord[];
}

export function createInMemoryCallLog(capacity = 5_000): LlmCallLog {
  const records: LlmCallRecord[] = [];
  return {
    append(record) {
      records.push(record);
      if (records.length > capacity) records.splice(0, records.length - capacity);
    },
    since(from) {
      return records.filter((r) => r.at >= from);
    },
  };
}

/** Keeps the journal in memory and appends each record to a JSONL file (playground, under .scratch/). */
export function createJsonlCallLog(path: string): LlmCallLog {
  const memory = createInMemoryCallLog();
  mkdirSync(dirname(path), { recursive: true });
  return {
    append(record) {
      memory.append(record);
      appendFileSync(path, `${JSON.stringify(record)}\n`);
    },
    since: (from) => memory.since(from),
  };
}

/**
 * Where the journal is kept for good: the llm_calls table, written by the app. The gateway never waits on it:
 * the daily cap is read from memory, refilled from the table so the API and the worker count each other's calls
 * and a restart forgets nothing.
 */
export interface LlmCallStore {
  insert(record: LlmCallRecord): Promise<void>;
  /** Every call since `from`, all creators and the playground together: the daily cap is one for the app. */
  listSince(from: Date): Promise<readonly LlmCallRecord[]>;
}

export interface PersistentCallLog extends LlmCallLog {
  /** Reloads the day's calls from the store; run at start-up, then every `refreshEveryMs`. */
  refresh(): Promise<void>;
  /** Stops the periodic reload, before the database closes. */
  stop(): void;
}

export interface PersistentCallLogOptions {
  /** The cap's day starts at midnight here (`config.dailyBudget.timeZone`). */
  readonly timeZone: string;
  /** The other process's calls reach this one's count within this delay. */
  readonly refreshEveryMs?: number;
  readonly onError: (error: unknown) => void;
  readonly now?: () => Date;
}

/**
 * A journal that writes through to `store` and holds the calls of the day, its own and the other process's.
 * A call not yet written is kept on top of what the store returns: a slow insert never lowers the count.
 */
export async function createPersistentCallLog(
  store: LlmCallStore,
  options: PersistentCallLogOptions,
): Promise<PersistentCallLog> {
  const now = options.now ?? (() => new Date());
  const pending = new Set<LlmCallRecord>();
  let stored: readonly LlmCallRecord[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;

  const refresh = async (): Promise<void> => {
    stored = await store.listSince(startOfLocalDay(now(), options.timeZone));
  };
  await refresh();
  if (options.refreshEveryMs !== undefined) {
    timer = setInterval(() => {
      refresh().catch(options.onError);
    }, options.refreshEveryMs);
    timer.unref();
  }

  return {
    append(record) {
      pending.add(record);
      store
        .insert(record)
        .then(() => {
          // Counted by the store from its next reload; kept until then so it is never missing in between.
          stored = [...stored, record];
          pending.delete(record);
        })
        // A lost row costs a line of history, never the call: the cap still counts it here.
        .catch(options.onError);
    },
    since: (from) => [...stored, ...pending].filter((r) => r.at >= from),
    refresh,
    stop() {
      clearInterval(timer);
    },
  };
}
