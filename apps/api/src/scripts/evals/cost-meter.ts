import { AsyncLocalStorage } from 'node:async_hooks';

import { UNBILLED_OUTCOMES, UNKNOWN_CALL_COST_USD, type LlmCallLog, type LlmCallRecord } from '@impera/llm';

/** What a call cost, counted as the gateway's cap counts it: a billed call with no price is a dear one. */
function billedUsd(record: LlmCallRecord): number {
  if (record.costUsd !== undefined) return record.costUsd;
  return UNBILLED_OUTCOMES.has(record.outcome) ? 0 : UNKNOWN_CALL_COST_USD;
}

export interface CostMeter {
  /** The journal to give the gateway: every call still goes to `log`, and to the work that made it. */
  readonly log: LlmCallLog;
  /** Runs `work` and says what its own calls cost, in euros, whatever else runs at the same time. */
  measure<T>(work: () => Promise<T>): Promise<{ readonly value: T; readonly costEur: number }>;
}

/**
 * Tells apart the cost of conversations played at once on one gateway: each call is counted to the work whose
 * async context made it.
 */
export function createCostMeter(log: LlmCallLog, usdPerEur: number): CostMeter {
  const current = new AsyncLocalStorage<{ usd: number }>();
  return {
    log: {
      append(record) {
        log.append(record);
        const tally = current.getStore();
        if (tally !== undefined) tally.usd += billedUsd(record);
      },
      since: (from) => log.since(from),
    },
    async measure(work) {
      const tally = { usd: 0 };
      const value = await current.run(tally, work);
      return { value, costEur: tally.usd / usdPerEur };
    },
  };
}
