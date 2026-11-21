import {
  InstagramMediaRefSchema,
  InstagramStoryRefSchema,
  type InstagramMedia,
  type MediaInsightNumbers,
  type MediaInsightSnapshot,
  type SnapshotAge,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { planReadings, snapshotsOf } from '../../domain/instagram-insights';
import { FakeInstagramInsights } from '../fake/FakeInstagramInsights';

const numbers = (views: number): MediaInsightNumbers => ({
  views,
  reach: views,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  reposts: null,
  skipRate: null,
});
const reel: InstagramMedia = {
  ref: InstagramMediaRefSchema.parse('reel-1'),
  kind: 'reel',
  caption: 'une légende inventée',
  publishedAt: '2026-11-16T12:00:00.000Z',
};
const night = (day: number) => new Date(`2026-11-${String(day)}T03:00:00.000Z`);

/** One run of the night as the job will do it: plan, read, keep. */
async function run(fake: FakeInstagramInsights, kept: MediaInsightSnapshot[], now: Date, budget = 10) {
  const media = await fake.listMedia(new Date('2026-11-01T00:00:00.000Z'));
  const keptOf = (ref: string): SnapshotAge[] =>
    kept.filter((snapshot) => snapshot.mediaRef === ref).map((snapshot) => snapshot.age);
  const plan = planReadings(media, keptOf, now, budget);
  for (const ref of plan.toRead) {
    const one = media.find((candidate) => candidate.ref === ref);
    if (one === undefined) continue;
    kept.push(...snapshotsOf(one, await fake.readInsights(ref), now, keptOf(ref)));
  }
  for (const one of media) kept.push(...snapshotsOf(one, null, now, keptOf(one.ref)));
  return plan;
}

describe('FakeInstagramInsights (ADR 0120 § 1 and § 2)', () => {
  it('is read only unless the second consent is given', () => {
    expect(new FakeInstagramInsights().capabilities).toEqual({ read: true, publish: false });
    expect(new FakeInstagramInsights({ publish: true }).capabilities.publish).toBe(true);
  });

  it('lists her media since a date, with their numbers on demand', async () => {
    const fake = new FakeInstagramInsights().seedMedia(reel, numbers(100));
    expect(await fake.listMedia(new Date('2026-11-17T00:00:00.000Z'))).toEqual([]);
    expect(await fake.listMedia(new Date('2026-11-16T00:00:00.000Z'))).toEqual([reel]);
    expect(await fake.readInsights(reel.ref)).toEqual(numbers(100));
  });

  it('writes nothing twice when the night is replayed, and never replaces an age kept', async () => {
    const fake = new FakeInstagramInsights().seedMedia(reel, numbers(100));
    const kept: MediaInsightSnapshot[] = [];
    await run(fake, kept, night(17));
    expect(kept.map((snapshot) => snapshot.age)).toEqual(['1h']);

    fake.setNumbers(reel.ref, numbers(500));
    await run(fake, kept, night(17));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.numbers?.views).toBe(100);
    expect(fake.calls.filter((call) => call.method === 'readInsights')).toHaveLength(1);

    await run(fake, kept, night(18));
    expect(kept.map((snapshot) => [snapshot.age, snapshot.numbers?.views])).toEqual([
      ['1h', 100],
      ['24h', 500],
    ]);
  });

  it('marks missed the steps of a night that never ran, without a call for a media too old to read', async () => {
    const fake = new FakeInstagramInsights().seedMedia(reel, numbers(100));
    const kept: MediaInsightSnapshot[] = [];
    await run(fake, kept, night(20));
    expect(kept.map((snapshot) => [snapshot.age, snapshot.numbers?.views ?? null])).toEqual([
      ['1h', null],
      ['24h', null],
      ['48h', 100],
    ]);

    await run(fake, kept, new Date('2026-12-20T03:00:00.000Z'));
    expect(kept.map((snapshot) => snapshot.age)).toEqual(['1h', '24h', '48h', '7d']);
    expect(kept[3]?.numbers).toBeNull();
    expect(fake.calls.filter((call) => call.method === 'readInsights')).toHaveLength(1);
  });

  it('stops at the quota, then picks up what waited on a later run', async () => {
    const other: InstagramMedia = { ...reel, ref: InstagramMediaRefSchema.parse('reel-2') };
    const fake = new FakeInstagramInsights().seedMedia(reel, numbers(1)).seedMedia(other, numbers(2));
    const kept: MediaInsightSnapshot[] = [];
    expect((await run(fake, kept, night(17), 1)).deferred).toBe(1);
    expect(kept).toHaveLength(1);
    expect((await run(fake, kept, night(17), 1)).deferred).toBe(0);
    expect(kept.map((snapshot) => snapshot.mediaRef).sort()).toEqual(['reel-1', 'reel-2']);
  });

  it('fails on an outage and when reading is not granted, without a guess', async () => {
    const fake = new FakeInstagramInsights().seedMedia(reel, numbers(1));
    fake.failWith(new Error('outage'));
    await expect(fake.readInsights(reel.ref)).rejects.toThrow('outage');
    fake.restore();
    await expect(fake.readInsights(reel.ref)).resolves.toEqual(numbers(1));
    await expect(new FakeInstagramInsights({ read: false }).listLiveStories()).rejects.toThrow();
    await expect(fake.readInsights(InstagramMediaRefSchema.parse('unknown'))).rejects.toThrow();
  });

  it('lists her stories online', async () => {
    const story = {
      ref: InstagramStoryRefSchema.parse('story-1'),
      publishedAt: '2026-11-16T09:00:00.000Z',
      views: 30,
      reach: 25,
    };
    expect(await new FakeInstagramInsights().seedStories(story).listLiveStories()).toEqual([story]);
  });
});
