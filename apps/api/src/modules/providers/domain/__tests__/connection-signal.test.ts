import { describe, expect, it } from 'vitest';

import {
  connectionServiceOf,
  credentialSignal,
  UNREACHABLE_AFTER_MS,
  unreachableSignal,
} from '../connection-signal';
import type { StoredCredential } from '../credential';

const saved: StoredCredential = {
  provider: 'elevenlabs',
  key: 'sk_FAKEFAKEFAKEFAKEFAKEFAKE',
  keyLabel: null,
  summary: 'Voix prête',
  facts: [],
  settings: {},
  voices: [],
  state: 'connected',
  verifiedAt: new Date('2026-11-03T08:00:00Z'),
  charactersLeft: null,
  lastErrorKind: null,
  revision: 1,
};

describe('connection signals of a saved key (Telegram P3-12)', () => {
  it('reads the line: working is back, refused or out of credit is down', () => {
    expect(credentialSignal(saved)).toEqual({ state: 'back' });
    expect(credentialSignal({ ...saved, state: 'low_credit' })).toEqual({
      state: 'down',
      reason: 'low_credit',
    });
    expect(
      credentialSignal({ ...saved, state: 'needs_reconnect', lastErrorKind: 'missing_permission' }),
    ).toEqual({
      state: 'down',
      reason: 'refused',
    });
    expect(credentialSignal({ ...saved, state: 'needs_reconnect', lastErrorKind: 'no_credit' })).toEqual({
      state: 'down',
      reason: 'low_credit',
    });
    // A row that no longer decrypts is the server's business, not an outage.
    expect(credentialSignal({ ...saved, key: null })).toBeNull();
  });

  it('tells silence once it has lasted, never over a line already red', () => {
    const at = (ms: number) => new Date(saved.verifiedAt.getTime() + ms);
    expect(unreachableSignal(saved, at(UNREACHABLE_AFTER_MS - 1))).toBeNull();
    expect(unreachableSignal(saved, at(UNREACHABLE_AFTER_MS))).toEqual({
      state: 'down',
      reason: 'unreachable',
    });
    expect(unreachableSignal({ ...saved, state: 'needs_reconnect' }, at(UNREACHABLE_AFTER_MS))).toBeNull();
  });

  it('names the watched services, never Venice', () => {
    expect(connectionServiceOf('google')).toBe('google');
    expect(connectionServiceOf('venice')).toBeNull();
  });
});
