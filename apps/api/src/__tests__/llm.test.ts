import { DEFAULT_LLM_CONFIG, MISTRAL_FALLBACK_MODEL } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { createAppLlm } from '../llm';
import { createLogger } from '../logger';
import { MISTRAL_WRITING_FALLBACK } from '../modules/providers/infra/mistral.verifier';

import { testConfig } from './support/config';

describe('createAppLlm', () => {
  it('tells the providers module which key a provider refused, and never throws into the call', async () => {
    const reported: string[] = [];
    const llm = createAppLlm({
      credentials: () => undefined,
      reportRefusedKey: (provider, kind) => {
        reported.push(`${provider}:${kind}`);
        return Promise.reject(new Error('database down'));
      },
      logger: createLogger(testConfig()),
    });
    expect(() => {
      llm.deps.onKeyRefused?.({ provider: 'xai', status: 401 });
      llm.deps.onKeyRefused?.({ provider: 'google', status: 403 });
    }).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(reported).toEqual(['xai:unauthorized', 'google:missing_permission']);
  });

  it('reports no voice key when none is connected', () => {
    const llm = createAppLlm({
      credentials: () => undefined,
      reportRefusedKey: () => Promise.resolve(),
      logger: createLogger(testConfig()),
    });
    expect(llm.gateway.health().roles.find((r) => r.role === 'voice')?.hasKey).toBe(false);
  });
});

describe('the writing fallback', () => {
  it('is one pinned model, the one a Mistral key is verified against, never an alias that moves', () => {
    expect(MISTRAL_WRITING_FALLBACK).toBe(MISTRAL_FALLBACK_MODEL);
    expect(DEFAULT_LLM_CONFIG.roles.voice.fallback?.model).toBe(MISTRAL_FALLBACK_MODEL);
    expect(DEFAULT_LLM_CONFIG.roles.brain.fallback?.model).toBe(MISTRAL_FALLBACK_MODEL);
    expect(MISTRAL_FALLBACK_MODEL).not.toMatch(/latest/);
  });
});
