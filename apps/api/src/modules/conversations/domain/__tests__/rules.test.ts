import { describe, expect, it } from 'vitest';

import {
  bubbleIdempotencyKey,
  canSend,
  debounceFor,
  DEFAULT_DEBOUNCE_SECONDS,
  deferredRespondAt,
  followUpIdempotencyKey,
  followUpRetry,
  nextFollowUp,
} from '../rules';

const AT = new Date('2026-10-17T20:00:00Z');
const later = (seconds: number) => new Date(AT.getTime() + seconds * 1_000);

describe('conversation rules', () => {
  it('waits 45 s by default and keeps a persona pace between 30 and 90 s', () => {
    expect(debounceFor()).toBe(DEFAULT_DEBOUNCE_SECONDS);
    expect(debounceFor({ debounceSeconds: 5 })).toBe(30);
    expect(debounceFor({ debounceSeconds: 60 })).toBe(60);
    expect(debounceFor({ debounceSeconds: 600 })).toBe(90);
  });

  it('sends an approved draft while the conversation is sending and the fan has not written since', () => {
    const base = {
      draftStatus: 'approved',
      draftCreatedAt: AT,
      conversationState: 'sending',
      lastInboundAt: AT,
    } as const;
    expect(canSend(base)).toBe(true);
    expect(canSend({ ...base, draftStatus: 'edited' })).toBe(true);
    expect(canSend({ ...base, draftStatus: 'pending' })).toBe(false);
    expect(canSend({ ...base, conversationState: 'human' })).toBe(false);
    expect(canSend({ ...base, lastInboundAt: later(1) })).toBe(false);
  });

  it('gives each bubble its own idempotency key', () => {
    expect(bubbleIdempotencyKey('d', 0)).not.toBe(bubbleIdempotencyKey('d', 1));
  });

  it('follows up at the first delay still ahead of his last message, never past the last one', () => {
    const hours = (h: number) => later(h * 3_600);
    expect(nextFollowUp(AT, [12, 23], hours(0.1))).toEqual({ step: 0, runAt: hours(12) });
    // She answered after 13 h: the 12 h follow-up is gone, the 23 h one is next.
    expect(nextFollowUp(AT, [12, 23], hours(13))).toEqual({ step: 1, runAt: hours(23) });
    // The 23 h follow-up itself went out: nothing after it.
    expect(nextFollowUp(AT, [12, 23], hours(23))).toBeNull();
    expect(nextFollowUp(AT, [], hours(1))).toBeNull();
    // He never wrote: she never writes first.
    expect(nextFollowUp(null, [12, 23], AT)).toBeNull();
  });

  it('keys a follow-up draft by his silence and its step', () => {
    expect(followUpIdempotencyKey('c', AT, 1)).toBe(`follow_up:c:${String(AT.getTime())}:1`);
  });

  it('puts a follow-up off within eight days, never into the past nor further', () => {
    expect(followUpRetry(undefined, AT)).toBeNull();
    expect(followUpRetry(later(9 * 3_600), AT)).toEqual(later(9 * 3_600));
    expect(followUpRetry(later(24 * 3_600), AT)).toEqual(later(24 * 3_600));
    // Her next reply slot may be days away (P3-14): up to eight days.
    expect(followUpRetry(later(8 * 24 * 3_600), AT)).toEqual(later(8 * 24 * 3_600));
    expect(followUpRetry(later(8 * 24 * 3_600 + 1), AT)).toBeNull();
    expect(followUpRetry(AT, AT)).toBeNull();
  });

  it('tries her answer again after a wait between 5 and 25 minutes, never otherwise (P3-11)', () => {
    expect(deferredRespondAt(undefined, AT)).toBeNull();
    expect(deferredRespondAt(later(5 * 60 - 1), AT)).toBeNull();
    expect(deferredRespondAt(later(5 * 60), AT)).toEqual(later(5 * 60));
    expect(deferredRespondAt(later(20 * 60), AT)).toEqual(later(20 * 60));
    expect(deferredRespondAt(later(25 * 60), AT)).toEqual(later(25 * 60));
    expect(deferredRespondAt(later(25 * 60 + 1), AT)).toBeNull();
  });
});
