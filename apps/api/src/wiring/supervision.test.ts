import type { RoleHealth } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { liveAnswerOf, voiceHealthOf } from './supervision';

const voice = (patch: Partial<RoleHealth>): RoleHealth => ({
  role: 'voice',
  state: 'ok',
  active: { provider: 'xai', model: 'grok-4.7', label: 'Grok 4.7' },
  fallback: { provider: 'mistral', model: 'mistral-large-4', label: 'Mistral Large', hasKey: true },
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
            model: 'mistral-large-4',
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

describe('liveAnswerOf (recette 27/11, A9)', () => {
  const at = (minute: number): Date => new Date(Date.UTC(2026, 10, 27, 14, minute));
  const brain = (patch: Partial<RoleHealth>): RoleHealth => voice({ role: 'brain', ...patch });

  it('is down while the brain fails, even when the voice, never called, looks fine', () => {
    expect(
      liveAnswerOf(
        voice({ lastSuccessAt: at(0) }),
        brain({ state: 'down', lastSuccessAt: at(1), downSince: at(5) }),
      ),
    ).toEqual({ lastAnsweredAt: at(1), down: { since: at(5) } });
  });

  it('dates the outage from the earliest failure of the two, and drops it once both answer', () => {
    expect(
      liveAnswerOf(voice({ state: 'down', downSince: at(9) }), brain({ state: 'down', downSince: at(4) })),
    ).toEqual({ down: { since: at(4) } });
    expect(liveAnswerOf(voice({ lastSuccessAt: at(20) }), brain({ lastSuccessAt: at(30) }))).toEqual({
      lastAnsweredAt: at(30),
    });
  });

  it('says down without a time for a role down for want of a key, and when no voice is known', () => {
    expect(liveAnswerOf(voice({ state: 'down' }), brain({}))).toEqual({ down: { since: null } });
    expect(liveAnswerOf(undefined, undefined)).toEqual({ down: { since: null } });
  });
});
