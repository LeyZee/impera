import { describe, expect, it } from 'vitest';

import { sessionLife } from '../session-life';

const now = new Date('2026-11-16T22:00:00Z');
const inHours = (hours: number): Date => new Date(now.getTime() + hours * 3_600_000);

describe('sessionLife', () => {
  it('takes a fresh login’s token as valid, nothing to redo', () => {
    expect(sessionLife(inHours(23.9), now)).toEqual({
      state: 'valid',
      expiresAt: inHours(23.9),
      reconnectFirst: false,
    });
  });

  it('asks to log in again under 20 hours left, still valid above 2 hours', () => {
    expect(sessionLife(inHours(19.9), now)).toMatchObject({ state: 'valid', reconnectFirst: true });
    expect(sessionLife(inHours(20), now)).toMatchObject({ state: 'valid', reconnectFirst: false });
  });

  it('says warning for yesterday’s token, an hour left (16/11)', () => {
    expect(sessionLife(inHours(0.95), now)).toMatchObject({ state: 'warning', reconnectFirst: true });
    expect(sessionLife(inHours(-1), now)).toMatchObject({ state: 'warning', reconnectFirst: true });
  });

  it('says nothing of a token whose expiry it cannot read', () => {
    expect(sessionLife(null, now)).toEqual({ state: 'valid', expiresAt: null, reconnectFirst: false });
  });
});
