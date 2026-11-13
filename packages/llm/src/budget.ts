import type { LlmPurpose } from '@impera/contracts';

import type { CallOutcome, LlmCallLog, LlmCallRecord } from './call-log';
import type { DailyBudget } from './config';

export type BudgetState = 'ok' | 'alert' | 'reached';

/** Today's spend against the hard daily cap (Charles, 17/10: 20 € a day, alert at 80 %, day in Paris). */
export interface BudgetStatus {
  /** Her calendar day in the budget's time zone, YYYY-MM-DD. */
  readonly day: string;
  readonly spentEur: number;
  readonly capEur: number;
  readonly alertAtEur: number;
  readonly state: BudgetState;
}

/** Sent once per day and kind: the CRM warns Charles; on `reached` the chatters take over. */
export interface BudgetEvent {
  readonly kind: 'alert' | 'reached';
  readonly status: BudgetStatus;
}

function wallClock(now: Date, timeZone: string): { day: string; minutes: number; seconds: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
    seconds: Number(part('second')),
  };
}

/** Local midnight in that zone, including on the days the clocks change. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const local = wallClock(now, timeZone);
  const elapsedMs = (local.minutes * 60 + local.seconds) * 1_000 + now.getMilliseconds();
  const candidate = new Date(now.getTime() - elapsedMs);
  // A clock change since midnight shifts the candidate by its offset: one correction lands on 00:00.
  const drift = wallClock(candidate, timeZone);
  if (drift.minutes === 0 && drift.seconds === 0) return candidate;
  const driftMinutes = drift.minutes > 12 * 60 ? drift.minutes - 24 * 60 : drift.minutes;
  return new Date(candidate.getTime() - driftMinutes * 60_000);
}

/**
 * A call the provider may have billed without saying how much (no usage, no price for the model): counted at this
 * much, so an unknown cost never lets the day go past its cap unnoticed. Far above a real voice or brain call.
 */
export const UNKNOWN_CALL_COST_USD = 0.05;
/** Refused before any work, or a server error (5xx): the provider bills nothing. */
export const UNBILLED_OUTCOMES: ReadonlySet<CallOutcome> = new Set([
  'auth',
  'rate_limited',
  'unavailable',
  'missing_key',
  'unknown_model',
]);

function billedUsd(record: LlmCallRecord): number {
  if (record.costUsd !== undefined) return record.costUsd;
  return UNBILLED_OUTCOMES.has(record.outcome) ? 0 : UNKNOWN_CALL_COST_USD;
}

/**
 * Costs are journaled in USD (provider prices); the cap is in euros, converted with a conservative rate.
 * The cap is checked before each call against the costs already journaled: calls in flight, and those of another
 * process until its journal is reloaded (30 s), are not counted yet. Going a few cents past the cap is possible
 * when several calls run at once; accepted, the cap protects against a runaway day, not against one cent.
 */
export function budgetStatus(
  budget: DailyBudget,
  capEur: number,
  log: LlmCallLog,
  now: Date,
  /** Only the calls made for this; every call when absent (the daily cap counts the trend watch too). */
  purpose?: LlmPurpose,
): BudgetStatus {
  const spentUsd = log
    .since(startOfLocalDay(now, budget.timeZone))
    .filter((record) => purpose === undefined || (record.purpose ?? 'chatting') === purpose)
    .reduce((sum, r) => sum + billedUsd(r), 0);
  const spentEur = spentUsd / budget.usdPerEur;
  const alertAtEur = capEur * budget.alertRatio;
  return {
    day: wallClock(now, budget.timeZone).day,
    spentEur,
    capEur,
    alertAtEur,
    state: spentEur >= capEur ? 'reached' : spentEur >= alertAtEur ? 'alert' : 'ok',
  };
}
