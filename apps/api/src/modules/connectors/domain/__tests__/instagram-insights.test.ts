import {
  InstagramMediaRefSchema,
  META_PUBLISH_SCOPES,
  META_READ_SCOPES,
  type InstagramMediaRef,
  type MediaInsightNumbers,
  type SnapshotAge,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  agesDue,
  callsLeft,
  dayHasStory,
  grantOf,
  planReadings,
  readingFailureAlert,
  snapshotsOf,
  tokenState,
} from '../instagram-insights';

const published = new Date('2026-11-16T12:00:00.000Z');
const after = (hours: number) => new Date(published.getTime() + hours * 3_600_000);
const ref = (name: string): InstagramMediaRef => InstagramMediaRefSchema.parse(name);
const numbers: MediaInsightNumbers = {
  views: 100,
  reach: 80,
  likes: 10,
  comments: 1,
  shares: 2,
  saves: 3,
  reposts: null,
  skipRate: null,
};

describe('what a grant of Meta lets the account do (ADR 0120 § 1)', () => {
  const read: readonly string[] = META_READ_SCOPES;
  const both: readonly string[] = [...META_READ_SCOPES, ...META_PUBLISH_SCOPES];

  it('connects in read only when only reading was asked and granted', () => {
    expect(grantOf(read, read)).toEqual({ accepted: true, capabilities: { read: true, publish: false } });
  });

  it('refuses a right that was not asked, the right to publish included', () => {
    expect(grantOf(read, both)).toEqual({ accepted: false, reason: 'unexpected_scope' });
    expect(grantOf(read, [...read, 'instagram_business_manage_messages'])).toEqual({
      accepted: false,
      reason: 'unexpected_scope',
    });
  });

  it('holds the closed list itself: a right outside it is refused even when asked and granted', () => {
    const withMessages = [...read, 'instagram_business_manage_messages'];
    expect(grantOf(withMessages, withMessages)).toEqual({ accepted: false, reason: 'asked_outside_list' });
    expect(grantOf(withMessages, read)).toEqual({ accepted: false, reason: 'asked_outside_list' });
    expect(grantOf(read, [...read, 'instagram_business_manage_comments'])).toEqual({
      accepted: false,
      reason: 'unexpected_scope',
    });
  });

  it('refuses a grant without the rights to read', () => {
    expect(grantOf(read, ['instagram_business_basic'])).toEqual({
      accepted: false,
      reason: 'read_scope_missing',
    });
  });

  it('gives the flag to publish only when the second consent asked it and Meta granted it', () => {
    expect(grantOf(both, both)).toEqual({ accepted: true, capabilities: { read: true, publish: true } });
    expect(grantOf(both, read)).toEqual({ accepted: true, capabilities: { read: true, publish: false } });
  });
});

describe('the readings kept by age (ADR 0120 § 2)', () => {
  it('keeps nothing before the first age', () => {
    expect(agesDue(published, after(0.5), [])).toEqual([]);
  });

  it('keeps an age at the first reading made after it', () => {
    expect(agesDue(published, after(1), [])).toEqual(['1h']);
    expect(agesDue(published, after(30), ['1h'])).toEqual(['24h']);
    expect(agesDue(published, after(24 * 7), ['1h', '24h', '48h'])).toEqual(['7d']);
  });

  it('never replaces an age already kept: a later reading, or a job replayed, writes nothing', () => {
    expect(agesDue(published, after(30), ['1h', '24h'])).toEqual([]);
    expect(
      snapshotsOf({ ref: ref('m1'), publishedAt: published.toISOString() }, numbers, after(30), [
        '1h',
        '24h',
      ]),
    ).toEqual([]);
  });

  it('keeps the real instant of a late reading beside every age it fills', () => {
    const readAt = after(60);
    expect(
      snapshotsOf({ ref: ref('m1'), publishedAt: published.toISOString() }, numbers, readAt, ['1h']),
    ).toEqual([
      { mediaRef: 'm1', age: '24h', readAt: readAt.toISOString(), numbers },
      { mediaRef: 'm1', age: '48h', readAt: readAt.toISOString(), numbers },
    ]);
  });
});

describe('the plan of a run under the quota of Meta (ADR 0120 § 2)', () => {
  const media = [
    { ref: ref('old'), publishedAt: after(-24 * 30).toISOString() },
    { ref: ref('recent'), publishedAt: after(-2).toISOString() },
    { ref: ref('done'), publishedAt: after(-24 * 30).toISOString() },
    { ref: ref('fresh'), publishedAt: after(-0.5).toISOString() },
  ];
  const kept = (one: InstagramMediaRef): readonly SnapshotAge[] =>
    one === 'done' ? ['1h', '24h', '48h', '7d'] : [];

  it('reads only the media with an age due, the most recent first', () => {
    expect(planReadings(media, kept, published, 10)).toEqual({ toRead: ['recent', 'old'], deferred: 0 });
  });

  it('stops at the budget and says what waits, without ever looping', () => {
    expect(planReadings(media, kept, published, 1)).toEqual({ toRead: ['recent'], deferred: 1 });
    expect(planReadings(media, kept, published, 0)).toEqual({ toRead: [], deferred: 2 });
    expect(planReadings(media, kept, published, -3)).toEqual({ toRead: [], deferred: 2 });
  });

  it('leaves a margin under the hourly limit', () => {
    expect(callsLeft(0, 100)).toBe(80);
    expect(callsLeft(79, 100)).toBe(1);
    expect(callsLeft(80, 100)).toBe(0);
    expect(callsLeft(500, 100)).toBe(0);
  });
});

describe('her stories online and the amber alerts (ADR 0120 § 2 and § 6)', () => {
  it('says whether the day has its story', () => {
    const dayStart = new Date('2026-11-16T00:00:00.000Z');
    expect(dayHasStory([{ publishedAt: '2026-11-15T22:00:00.000Z' }], dayStart)).toBe(false);
    expect(dayHasStory([{ publishedAt: '2026-11-16T08:00:00.000Z' }], dayStart)).toBe(true);
    expect(dayHasStory([], dayStart)).toBe(false);
  });

  it('turns amber when the token expires under seven days, and says when it is expired', () => {
    const now = new Date('2026-11-16T12:00:00.000Z');
    expect(tokenState(new Date('2026-12-16T12:00:00.000Z'), now)).toBe('valid');
    expect(tokenState(new Date('2026-11-23T12:00:00.000Z'), now)).toBe('valid');
    expect(tokenState(new Date('2026-11-23T11:59:59.000Z'), now)).toBe('expiring');
    expect(tokenState(now, now)).toBe('expired');
  });

  it('alerts on a reading that fails two nights in a row, not one', () => {
    expect(readingFailureAlert(1)).toBe(false);
    expect(readingFailureAlert(2)).toBe(true);
  });
});
