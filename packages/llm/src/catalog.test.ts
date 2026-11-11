import type { LanguageModelUsage } from 'ai';
import { describe, expect, it } from 'vitest';

import { costUsd, findModel } from './catalog';
import { DEFAULT_LLM_CONFIG } from './config';

const usage = (inputTokens: number, outputTokens: number, cacheReadTokens = 0): LanguageModelUsage => ({
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  inputTokenDetails: { noCacheTokens: inputTokens - cacheReadTokens, cacheReadTokens, cacheWriteTokens: 0 },
  outputTokenDetails: { textTokens: outputTokens, reasoningTokens: 0 },
});

describe('prices of the catalog', () => {
  it('knows a price for every model a role writes or falls back with: the daily cap never counts a guess', () => {
    for (const role of Object.values(DEFAULT_LLM_CONFIG.roles)) {
      expect(findModel(role)?.pricing, role.model).toBeDefined();
      if (role.fallback !== undefined)
        expect(findModel(role.fallback)?.pricing, role.fallback.model).toBeDefined();
    }
  });

  it('bills a short Grok request at the standard rates, cached input apart', () => {
    const grok = { provider: 'xai', model: 'grok-4.7' } as const;
    expect(costUsd(grok, usage(100_000, 100_000))).toBeCloseTo(0.8, 6);
    expect(costUsd(grok, usage(100_000, 0, 100_000))).toBeCloseTo(0.05, 6);
  });

  it('bills every token of a Grok request at the long rates once its prompt reaches 200 000 tokens', () => {
    const grok = { provider: 'xai', model: 'grok-4.7' } as const;
    expect(costUsd(grok, usage(199_999, 1_000))).toBeCloseTo((199_999 * 2 + 1_000 * 6) / 1e6, 6);
    expect(costUsd(grok, usage(200_000, 1_000))).toBeCloseTo((200_000 * 4 + 1_000 * 12) / 1e6, 6);
  });

  it('gives no cost for a model without a price', () => {
    expect(costUsd({ provider: 'venice', model: 'unknown' }, usage(10, 10))).toBeUndefined();
  });
});
