import { describe, expect, it } from 'vitest';

import { budgetStatus } from './budget';
import { createInMemoryCallLog, type LlmCallRecord } from './call-log';
import { DEFAULT_LLM_CONFIG } from './config';
import { computeHealth } from './health';

const NOW = new Date('2026-10-17T15:00:00Z');

function call(minutesAgo: number, outcome: LlmCallRecord['outcome'], latencyMs = 100): LlmCallRecord {
  return {
    at: new Date(NOW.getTime() - minutesAgo * 60_000),
    role: 'voice',
    provider: 'xai',
    model: 'grok-4.7',
    promptHash: 'h',
    outcome,
    latencyMs,
    isFallback: false,
  };
}

function voiceHealth(records: LlmCallRecord[]) {
  const log = createInMemoryCallLog();
  for (const r of records) log.append(r);
  const budget = budgetStatus(DEFAULT_LLM_CONFIG.dailyBudget, 20, log, NOW);
  return computeHealth(DEFAULT_LLM_CONFIG, { LLM_XAI_API_KEY: 'k' }, log, NOW, budget, budget).roles.find(
    (r) => r.role === 'voice',
  );
}

describe('computeHealth', () => {
  it('takes the lower median of two latencies', () => {
    expect(voiceHealth([call(5, 'ok', 100), call(4, 'ok', 300)])?.latencyP50Ms).toBe(100);
  });

  it('judges the error rate on the last hour only', () => {
    const badMorning = [call(300, 'unavailable'), call(299, 'unavailable'), call(298, 'unavailable')];
    expect(voiceHealth([...badMorning, call(10, 'ok')])?.state).toBe('ok');
    const badHour = [call(30, 'unavailable'), call(20, 'ok'), call(10, 'unavailable'), call(5, 'ok')];
    expect(voiceHealth([call(400, 'ok'), ...badHour])?.state).toBe('degraded');
  });
});
