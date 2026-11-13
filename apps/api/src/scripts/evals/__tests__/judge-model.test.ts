import { DEFAULT_LLM_CONFIG } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { EVALS_JUDGE_TIMEOUT_MS, evalsConfig } from '../judge-model';

describe('evalsConfig', () => {
  it('moves the judge off the voice’s provider when another key exists', () => {
    const mistral = evalsConfig(DEFAULT_LLM_CONFIG, { LLM_XAI_API_KEY: 'x', LLM_MISTRAL_API_KEY: 'm' });
    expect(mistral.isIndependent).toBe(true);
    expect(mistral.config.roles.judge).toMatchObject({ provider: 'mistral', temperature: 0 });
    expect(mistral.config.roles.voice).toEqual(DEFAULT_LLM_CONFIG.roles.voice);
    const google = evalsConfig(DEFAULT_LLM_CONFIG, { LLM_XAI_API_KEY: 'x', LLM_GOOGLE_API_KEY: 'g' });
    expect(google.config.roles.judge.provider).toBe('google');
  });

  it('keeps the voice’s provider and says so when it is the only key', () => {
    const only = evalsConfig(DEFAULT_LLM_CONFIG, { LLM_XAI_API_KEY: 'x' });
    expect(only.isIndependent).toBe(false);
    expect(only.config.roles.judge.provider).toBe('xai');
  });

  it('gives the judge more time in the evals, and only the judge (OPS-07)', () => {
    for (const credentials of [
      { LLM_XAI_API_KEY: 'x' },
      { LLM_XAI_API_KEY: 'x', LLM_MISTRAL_API_KEY: 'm' },
    ]) {
      const { config } = evalsConfig(DEFAULT_LLM_CONFIG, credentials);
      expect(config.roles.judge.timeoutMs).toBe(EVALS_JUDGE_TIMEOUT_MS);
      expect(EVALS_JUDGE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_LLM_CONFIG.roles.judge.timeoutMs);
      expect(config.roles.voice).toEqual(DEFAULT_LLM_CONFIG.roles.voice);
      expect(config.roles.brain).toEqual(DEFAULT_LLM_CONFIG.roles.brain);
    }
    expect(DEFAULT_LLM_CONFIG.roles.judge.timeoutMs).toBe(60_000);
  });
});
