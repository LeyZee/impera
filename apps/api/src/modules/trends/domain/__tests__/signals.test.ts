import { describe, expect, it } from 'vitest';

import { isLive, signalExpiresAt, STANDS_OUT_FACTOR, STANDS_OUT_MIN_POSTS, standsOut } from '../signals';

const at = new Date('2026-11-03T08:00:00.000Z');
const post = (views: number | null, likes: number | null = null) => ({ views, likes, comments: null });

describe('a signal’s lifetime (ADR 0060 § 2)', () => {
  it('lives 14 days by default, and is gone at its expiry', () => {
    const expiresAt = signalExpiresAt(at);
    expect(expiresAt.toISOString()).toBe('2026-11-17T08:00:00.000Z');
    expect(isLive({ expiresAt }, new Date(expiresAt.getTime() - 1))).toBe(true);
    expect(isLive({ expiresAt }, expiresAt)).toBe(false);
  });

  it('takes the agency’s lifetime, one day at least', () => {
    expect(signalExpiresAt(at, 3).toISOString()).toBe('2026-11-06T08:00:00.000Z');
    expect(() => signalExpiresAt(at, 0)).toThrow(RangeError);
    expect(() => signalExpiresAt(at, 1.5)).toThrow(RangeError);
  });
});

describe('« dépasse nettement la moyenne de son compte »', () => {
  const others = Array.from({ length: STANDS_OUT_MIN_POSTS }, () => post(1_000, 50));

  it('stands out at three times the mean of the others, by views', () => {
    expect(standsOut(post(STANDS_OUT_FACTOR * 1_000), others)).toBe(true);
    expect(standsOut(post(STANDS_OUT_FACTOR * 1_000 - 1), others)).toBe(false);
  });

  it('needs enough posts of the account read', () => {
    expect(standsOut(post(100_000), others.slice(1))).toBe(false);
  });

  it('falls back on likes when the page gave no views', () => {
    expect(standsOut(post(null, 150), others)).toBe(true);
    expect(standsOut(post(null, 149), others)).toBe(false);
    expect(standsOut(post(null, null), others)).toBe(false);
  });

  it('reads a mean of zero without dividing by it', () => {
    const silent = Array.from({ length: STANDS_OUT_MIN_POSTS }, () => post(0));
    expect(standsOut(post(1), silent)).toBe(true);
    expect(standsOut(post(0), silent)).toBe(false);
  });
});
