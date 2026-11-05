import { describe, expect, it } from 'vitest';

import { budgetStatus, startOfLocalDay } from './budget';
import { createInMemoryCallLog, type LlmCallRecord } from './call-log';
import { DEFAULT_LLM_CONFIG } from './config';

const call = (at: string, costUsd?: number): LlmCallRecord => ({
  at: new Date(at),
  role: 'voice',
  provider: 'xai',
  model: 'grok-4.7',
  promptHash: 'h',
  outcome: 'ok',
  latencyMs: 100,
  isFallback: false,
  ...(costUsd !== undefined && { costUsd }),
});

describe('daily budget', () => {
  it('counts a call of unknown cost at a high estimate, and a refused key or a server error at nothing', () => {
    const log = createInMemoryCallLog();
    const unknown = call('2026-10-17T08:00:00Z');
    log.append({ ...unknown, outcome: 'timeout' });
    log.append({ ...unknown, outcome: 'auth' });
    log.append({ ...unknown, outcome: 'unavailable' });
    const { dailyBudget } = DEFAULT_LLM_CONFIG;
    const status = budgetStatus(dailyBudget, 20, log, new Date('2026-10-17T20:00:00Z'));
    expect(status.spentEur).toBeCloseTo(0.05 / dailyBudget.usdPerEur);
  });

  it('sums one purpose apart, and every call for the daily cap', () => {
    const log = createInMemoryCallLog();
    log.append(call('2026-10-17T08:00:00Z', 0.11));
    log.append({ ...call('2026-10-17T09:00:00Z', 0.22), purpose: 'trend_watch' });
    log.append({ ...call('2026-10-17T10:00:00Z', 0.33), purpose: 'chatting' });
    const { dailyBudget } = DEFAULT_LLM_CONFIG;
    const at = new Date('2026-10-17T20:00:00Z');
    expect(budgetStatus(dailyBudget, 20, log, at).spentEur).toBeCloseTo(0.66 / dailyBudget.usdPerEur);
    expect(budgetStatus(dailyBudget, 1, log, at, 'trend_watch').spentEur).toBeCloseTo(
      0.22 / dailyBudget.usdPerEur,
    );
    expect(budgetStatus(dailyBudget, 20, log, at, 'chatting').spentEur).toBeCloseTo(
      0.44 / dailyBudget.usdPerEur,
    );
  });

  it('starts the day at midnight in Paris, including the day the clocks go back', () => {
    expect(startOfLocalDay(new Date('2026-10-17T20:05:00Z'), 'Europe/Paris').toISOString()).toBe(
      '2026-10-16T22:00:00.000Z',
    );
    // 25 October 2026: midnight is still UTC+2, the afternoon is UTC+1.
    expect(startOfLocalDay(new Date('2026-10-25T15:00:00Z'), 'Europe/Paris').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    );
  });

  it('counts only her day, in euros, with the alert at 80 % of the cap', () => {
    const log = createInMemoryCallLog();
    log.append(call('2026-10-16T21:59:00Z', 50)); // yesterday in Paris
    log.append(call('2026-10-17T08:00:00Z', 17.6)); // 16 €
    const now = new Date('2026-10-17T20:00:00Z');
    const { dailyBudget } = DEFAULT_LLM_CONFIG;

    expect(budgetStatus(dailyBudget, 20, log, now)).toEqual({
      day: '2026-10-17',
      spentEur: 16,
      capEur: 20,
      alertAtEur: 16,
      state: 'alert',
    });
    log.append(call('2026-10-17T19:00:00Z', 4.4));
    expect(budgetStatus(dailyBudget, 20, log, now).state).toBe('reached');
    expect(budgetStatus(dailyBudget, 30, log, now).state).toBe('ok');
  });
});
