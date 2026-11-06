import type { RoleHealth } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { voiceHealthOf } from './supervision';

const voice = (patch: Partial<RoleHealth>): RoleHealth => ({
  role: 'voice',
  state: 'ok',
  active: { provider: 'xai', model: 'grok-4.7', label: 'Grok 4.7' },
  fallback: { provider: 'mistral', model: 'mistral-large-latest', label: 'Mistral Large', hasKey: true },
  hasKey: true,
  isOnFallback: false,
  callsLastHour: 0,
  errorRateLastHour: 0,
  costTodayUsd: 0,
  ...patch,
});

describe('voiceHealthOf (recette AGT 06/11)', () => {
  it('says the voice answers while Mistral writes in place of a refused Grok key', () => {
    expect(voiceHealthOf(voice({ state: 'degraded', hasKey: false }))).toEqual({
      ok: true,
      keyMissing: false,
    });
    expect(voiceHealthOf(voice({ state: 'degraded', isOnFallback: true }))).toEqual({
      ok: true,
      keyMissing: false,
    });
  });

  it('says it is down only when nothing answers, and its key missing only when neither model has one', () => {
    expect(voiceHealthOf(voice({ state: 'down' }))).toEqual({ ok: false, keyMissing: false });
    expect(
      voiceHealthOf(
        voice({
          state: 'down',
          hasKey: false,
          fallback: {
            provider: 'mistral',
            model: 'mistral-large-latest',
            label: 'Mistral Large',
            hasKey: false,
          },
        }),
      ),
    ).toEqual({ ok: false, keyMissing: true });
    expect(voiceHealthOf(undefined)).toEqual({ ok: false, keyMissing: true });
    expect(voiceHealthOf(voice({}))).toEqual({ ok: true, keyMissing: false });
  });
});
