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
  callsLeft,
  dayHasStory,
  grantOf,
  planReadings,
  readingBudget,
  readingFailureAlert,
  snapshotsOf,
  stepsDue,
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

describe('the readings kept by age, and the steps missed (ADR 0120 § 2, amendment of 20/11/2026)', () => {
  const media = { ref: ref('m1'), publishedAt: published.toISOString() };

  it('owes nothing before the first age', () => {
    expect(stepsDue(published, after(0.5), [])).toEqual({ fill: null, missed: [] });
  });

  it('fills the step whose window holds the age of the media, and one step at most', () => {
    expect(stepsDue(published, after(1), [])).toEqual({ fill: '1h', missed: [] });
    expect(stepsDue(published, after(23.9), [])).toEqual({ fill: '1h', missed: [] });
    expect(stepsDue(published, after(30), ['1h'])).toEqual({ fill: '24h', missed: [] });
    expect(stepsDue(published, after(24 * 7), ['1h', '24h', '48h'])).toEqual({ fill: '7d', missed: [] });
  });

  it('marks missed a step whose window passed without a reading: a late figure never enters it', () => {
    expect(stepsDue(published, after(24), [])).toEqual({ fill: '24h', missed: ['1h'] });
    expect(stepsDue(published, after(24 * 3), ['1h'])).toEqual({ fill: '48h', missed: ['24h'] });
    const late = after(24 * 3);
    expect(snapshotsOf(media, numbers, late, [])).toEqual([
      { mediaRef: 'm1', age: '1h', readAt: late.toISOString(), numbers: null },
      { mediaRef: 'm1', age: '24h', readAt: late.toISOString(), numbers: null },
      { mediaRef: 'm1', age: '48h', readAt: late.toISOString(), numbers },
    ]);
  });

  it('does not fill seven days at exactly fourteen: every step is missed, and nothing is left to read', () => {
    expect(stepsDue(published, after(24 * 14 - 0.1), ['1h', '24h', '48h'])).toEqual({
      fill: '7d',
      missed: [],
    });
    expect(stepsDue(published, after(24 * 14), ['1h', '24h', '48h'])).toEqual({ fill: null, missed: ['7d'] });
    expect(stepsDue(published, after(24 * 400), [])).toEqual({
      fill: null,
      missed: ['1h', '24h', '48h', '7d'],
    });
  });

  it('never replaces a step already kept, read or missed: a job replayed writes nothing', () => {
    expect(stepsDue(published, after(30), ['1h', '24h'])).toEqual({ fill: null, missed: [] });
    expect(snapshotsOf(media, numbers, after(30), ['1h', '24h'])).toEqual([]);
    expect(snapshotsOf(media, numbers, after(24 * 400), ['1h', '24h', '48h', '7d'])).toEqual([]);
  });

  it('keeps only the missed steps when there was no reading, and leaves the open step due', () => {
    const at = after(30);
    expect(snapshotsOf(media, null, at, [])).toEqual([
      { mediaRef: 'm1', age: '1h', readAt: at.toISOString(), numbers: null },
    ]);
    expect(stepsDue(published, at, ['1h'])).toEqual({ fill: '24h', missed: [] });
  });
});

describe('the plan of a run under the quota of Meta (ADR 0120 § 2)', () => {
  const media = [
    { ref: ref('old'), publishedAt: after(-24 * 30).toISOString() },
    { ref: ref('week'), publishedAt: after(-24 * 8).toISOString() },
    { ref: ref('recent'), publishedAt: after(-2).toISOString() },
    { ref: ref('done'), publishedAt: after(-24 * 30).toISOString() },
    { ref: ref('fresh'), publishedAt: after(-0.5).toISOString() },
  ];
  const kept = (one: InstagramMediaRef): readonly SnapshotAge[] =>
    one === 'done' ? ['1h', '24h', '48h', '7d'] : [];

  it('reads only the media with a step to fill now, the most recent first', () => {
    expect(planReadings(media, kept, published, 10)).toEqual({ toRead: ['recent', 'week'], deferred: 0 });
  });

  it('spends no call on a media that only has missed steps', () => {
    expect(planReadings(media, kept, published, 10).toRead).not.toContain('old');
  });

  it('stops at the budget and says what waits, without ever looping', () => {
    expect(planReadings(media, kept, published, 1)).toEqual({ toRead: ['recent'], deferred: 1 });
    expect(planReadings(media, kept, published, 0)).toEqual({ toRead: [], deferred: 2 });
    expect(planReadings(media, kept, published, -3)).toEqual({ toRead: [], deferred: 2 });
  });

  it('pays the listings before the readings', () => {
    expect(readingBudget(10, 2, true)).toBe(7);
    expect(readingBudget(10, 0, false)).toBe(10);
    expect(readingBudget(2, 3, true)).toBe(0);
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
