import { createInMemoryCallLog, UNKNOWN_CALL_COST_USD, type LlmCallRecord } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { createCostMeter } from '../cost-meter';

const call = (costUsd: number | undefined, outcome: LlmCallRecord['outcome'] = 'ok'): LlmCallRecord => ({
  at: new Date('2026-11-06T20:00:00Z'),
  role: 'voice',
  provider: 'xai',
  model: 'modele-fictif',
  promptHash: 'h',
  outcome,
  latencyMs: 1,
  isFallback: false,
  ...(costUsd !== undefined && { costUsd }),
});

const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 1);
  });

describe('createCostMeter', () => {
  it('counts each call to the conversation that made it, though two run at once', async () => {
    const inner = createInMemoryCallLog();
    const meter = createCostMeter(inner, 2);
    const conversation = (costs: readonly number[]) => async (): Promise<number> => {
      for (const cost of costs) {
        await tick();
        meter.log.append(call(cost));
      }
      return costs.length;
    };
    const [a, b] = await Promise.all([
      meter.measure(conversation([0.2, 0.2, 0.2])),
      meter.measure(conversation([1, 1])),
    ]);
    expect(a.value).toBe(3);
    expect(a.costEur).toBeCloseTo(0.3);
    expect(b.costEur).toBeCloseTo(1);
    // The gateway's journal keeps every call, for the pass's cap.
    expect(inner.since(new Date(0))).toHaveLength(5);
  });

  it('counts a billed call with no price as the cap does, an unbilled one at nothing', async () => {
    const meter = createCostMeter(createInMemoryCallLog(), 1);
    const { costEur } = await meter.measure(() => {
      meter.log.append(call(undefined));
      meter.log.append(call(undefined, 'rate_limited'));
      return Promise.resolve();
    });
    expect(costEur).toBeCloseTo(UNKNOWN_CALL_COST_USD);
  });
});
