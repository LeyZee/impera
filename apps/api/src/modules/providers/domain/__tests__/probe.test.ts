import { describe, expect, it } from 'vitest';

import { applyProbe, toStatus, type StoredCredential } from '../credential';
import { probeOutcomeOf, troubleOf } from '../probe';

const saved: StoredCredential = {
  provider: 'elevenlabs',
  key: 'sk_FAKEFAKEFAKEFAKE',
  keyLabel: null,
  summary: 'Voix de la créatrice · 75 vocaux ce mois',
  facts: [],
  settings: {},
  voices: [],
  state: 'connected',
  verifiedAt: new Date('2026-11-16T12:00:00Z'),
  charactersLeft: 7_500,
  quota: { limit: 10_000, resetsAt: new Date('2026-12-01T00:00:00Z'), plan: 'free' },
  probe: null,
  lastErrorKind: null,
  revision: 1,
};

describe('« Essai réel » (ADR 0091 § 7)', () => {
  it('reads only the journal outcomes that say something of the connection', () => {
    expect(troubleOf('quota_exhausted')).toBe('no_credit');
    expect(troubleOf('auth')).toBe('key_refused');
    expect(troubleOf('timeout')).toBe('timeout');
    expect(troubleOf('unavailable')).toBe('not_answering');
    expect(troubleOf('refused')).toBeNull();
    expect(troubleOf('invalid_output')).toBeNull();
    expect(probeOutcomeOf('ok')).toBe('answers');
    expect(probeOutcomeOf('budget_reached')).toBe('budget_reached');
    expect(probeOutcomeOf('refused')).toBe('answers');
  });

  it('keeps what it found, and a key refused on the real call turns red at once', () => {
    const at = new Date('2026-11-16T13:40:00Z');
    const answered = applyProbe(saved, { outcome: 'answers', latencyMs: 640, model: 'Flash v2.5' }, at);
    expect(answered).toMatchObject({ state: 'connected', probe: { outcome: 'answers', at } });
    const refused = applyProbe(saved, { outcome: 'key_refused', latencyMs: 200, model: 'Flash v2.5' }, at);
    expect(refused).toMatchObject({ state: 'needs_reconnect', lastErrorKind: 'unauthorized' });
    const empty = applyProbe(saved, { outcome: 'no_credit', latencyMs: 200, model: 'Flash v2.5' }, at);
    expect(empty.state).toBe('connected');
  });

  it('shows the month as used out of the limit, and the last essai', () => {
    const at = new Date('2026-11-16T13:40:00Z');
    const status = toStatus(
      'elevenlabs',
      applyProbe(saved, { outcome: 'answers', latencyMs: 640, model: 'Flash v2.5' }, at),
      'dashboard',
    );
    expect(status.quota).toEqual({
      used: 2_500,
      limit: 10_000,
      resetsAt: '2026-12-01T00:00:00.000Z',
      plan: 'free',
    });
    expect(status.probe).toEqual({
      at: '2026-11-16T13:40:00.000Z',
      outcome: 'answers',
      latencyMs: 640,
      model: 'Flash v2.5',
    });
    expect(status.activity).toBeNull();
  });
});
