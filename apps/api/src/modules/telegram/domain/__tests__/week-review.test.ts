import { describe, expect, it } from 'vitest';

import { engagementMark, gestureRefusal, locksPost, repostChoice, sendKeyOf } from '../week-review';

const at = new Date('2026-11-24T18:48:00Z');
const before = new Date('2026-11-24T17:00:00Z');

describe('the review of her channel’s week (ADR 0162 § 3)', () => {
  it('allows a gesture on a waiting post up to its hour, never after', () => {
    const post = { state: 'planned' as const, at, kind: 'main' as const };
    expect(gestureRefusal(post, { gesture: 'validate' }, before)).toBeNull();
    expect(gestureRefusal(post, { gesture: 'validate' }, at)).toBe('too_late');
    expect(gestureRefusal({ ...post, state: 'sent' }, { gesture: 'remove' }, before)).toBe('not_planned');
  });

  it('rewrites a poll rather than editing it by hand', () => {
    const poll = { state: 'planned' as const, at, kind: 'poll' as const };
    expect(gestureRefusal(poll, { gesture: 'edit', text: 'Verte ou noire ?' }, before)).toBe('not_a_text');
    expect(gestureRefusal(poll, { gesture: 'rewrite', advice: null }, before)).toBeNull();
  });

  it('locks a post a hand touched, never one removed', () => {
    expect(locksPost({ gesture: 'validate' })).toBe(true);
    expect(locksPost({ gesture: 'edit', text: 'Coucou' })).toBe(true);
    expect(locksPost({ gesture: 'remove' })).toBe(false);
  });

  it('marks a post by its reactions and, three times more, its clicks', () => {
    expect(engagementMark(4, null)).toBe(4);
    expect(engagementMark(4, 2)).toBe(10);
  });

  it('reposts the best media older than 60 days, once a week at most (§ 6)', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const day = 24 * 60 * 60 * 1000;
    const past = [
      { mediaId: 'recent', lastSentAt: new Date(now.getTime() - 10 * day), mark: 99 },
      { mediaId: 'old-good', lastSentAt: new Date(now.getTime() - 90 * day), mark: 12 },
      { mediaId: 'old-weak', lastSentAt: new Date(now.getTime() - 120 * day), mark: 3 },
    ];
    expect(repostChoice(past, 0, now)?.mediaId).toBe('old-good');
    expect(repostChoice(past, 1, now)).toBeNull();
    expect(repostChoice(past.slice(0, 1), 0, now)).toBeNull();
  });

  it('keys a send by the post, so a replay never sends it twice', () => {
    expect(sendKeyOf('abc')).toBe('telegram_channel_post:abc');
  });
});
