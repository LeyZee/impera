import { DEFAULT_LLM_CONFIG } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { EVALS_JUDGE_MAX_OUTPUT_TOKENS, EVALS_JUDGE_TIMEOUT_MS, evalsConfig } from '../judge-model';

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

  it('gives the judge room for its nine reasons in the evals, and only the judge', () => {
    for (const credentials of [
      { LLM_XAI_API_KEY: 'x' },
      { LLM_XAI_API_KEY: 'x', LLM_MISTRAL_API_KEY: 'm' },
      { LLM_XAI_API_KEY: 'x', LLM_GOOGLE_API_KEY: 'g' },
    ]) {
      const { config } = evalsConfig(DEFAULT_LLM_CONFIG, credentials);
      expect(config.roles.judge.maxOutputTokens).toBe(EVALS_JUDGE_MAX_OUTPUT_TOKENS);
      expect(EVALS_JUDGE_MAX_OUTPUT_TOKENS).toBeGreaterThan(DEFAULT_LLM_CONFIG.roles.judge.maxOutputTokens);
      expect(config.roles.voice).toEqual(DEFAULT_LLM_CONFIG.roles.voice);
    }
  });

  it('leaves a thinking judge room for its thinking and its scores (PC, 21/11)', () => {
    // Mistral Large 4 spent up to 4 618 tokens thinking on a short conversation before writing a word.
    expect(EVALS_JUDGE_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(4_618 + 2_000);
  });
});
