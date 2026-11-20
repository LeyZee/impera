import {
  CreatorIdSchema,
  InstagramMediaRefSchema,
  newId,
  TeamMemberIdSchema,
  type InstagramMedia,
  type MediaInsightNumbers,
} from '@impera/contracts';
import { schema, sql, withTenant, withTenantJob, withTenantMember, type Transaction } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { readMediaInsights } from '../../../application/media-insights';
import { FakeInstagramInsights } from '../../fake/FakeInstagramInsights';
import { createDrizzleMediaInsightStore } from '../media-insights-store';

// Everything below is invented (ADR 0010).
const numbers = (views: number, more: Partial<MediaInsightNumbers> = {}): MediaInsightNumbers => ({
  views,
  reach: views,
  likes: 1,
  comments: 2,
  shares: 3,
  saves: 4,
  reposts: null,
  skipRate: null,
  ...more,
});
const published = '2026-11-16T12:00:00.000Z';
const reel: InstagramMedia = {
  ref: InstagramMediaRefSchema.parse('reel-1'),
  kind: 'reel',
  caption: 'une légende inventée',
  publishedAt: published,
};
const photo: InstagramMedia = {
  ref: InstagramMediaRefSchema.parse('photo-1'),
  kind: 'photo',
  caption: null,
  publishedAt: published,
};
const hoursAfter = (hours: number) => new Date(Date.parse(published) + hours * 60 * 60 * 1000);

/**
 * The readings of her Instagram numbers kept in the base (ADR 0120 § 2, amendment of 20/11/2026): the run against
 * the fake Instagram, the steps missed, and who writes and reads the rows.
 */
describe('the readings of her Instagram numbers, kept by step', () => {
  let test: TestDb;
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const users = {
    owner: 'user_owner',
    manager: 'user_manager',
    outsideManager: 'user_manager_outside',
    chatter: 'user_chatter',
    creator: 'user_creator',
  };
  const rows = () =>
    test.admin.db
      .select()
      .from(schema.mediaInsightSnapshots)
      .orderBy(
        schema.mediaInsightSnapshots.mediaRef,
        sql`array_position(array['1h', '24h', '48h', '7d'], ${schema.mediaInsightSnapshots.age})`,
      );
  const steps = async (creatorId: string) =>
    (await rows())
      .filter((row) => row.creatorId === creatorId)
      .map((row) => [row.mediaRef, row.age, row.missed ? null : row.views]);
  const count = (tx: Transaction) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from media_insight_snapshots`);
  const step = (creatorId: string, mediaRef: string) => ({
    id: newId(CreatorIdSchema),
    creatorId,
    mediaRef,
    mediaKind: 'reel',
    publishedAt: new Date(published),
    age: '1h',
    readAt: new Date(),
    missed: true,
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: ines, nameKey: 'ines', displayName: 'Ines', timezone: 'Europe/Paris' },
    ]);
    const accounts: [string, 'owner' | 'operator' | 'creator', string[], 'manager' | 'chatter' | null][] = [
      [users.owner, 'owner', [], null],
      [users.manager, 'operator', [nora], 'manager'],
      [users.outsideManager, 'operator', [ines], 'manager'],
      [users.chatter, 'operator', [nora], 'chatter'],
      [users.creator, 'creator', [nora], null],
    ];
    for (const [id, role, creatorIds, teamRole] of accounts) {
      await test.admin.db
        .insert(schema.user)
        .values({ id, name: id, email: `${id}@example.test`, role, creatorIds });
      if (teamRole !== null)
        await test.admin.db.insert(schema.teamMembers).values({
          id: newId(TeamMemberIdSchema),
          userId: id,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: id,
          country: 'FR',
          timeZone: 'Europe/Paris',
          joinedOn: '2026-10-01',
        });
    }
  });

  afterAll(async () => {
    await test.close();
  });

  it('fills the step of the hour, marks missed the ones that passed, and writes nothing when replayed', async () => {
    const store = createDrizzleMediaInsightStore(test.app.db);
    const instagram = new FakeInstagramInsights()
      .seedMedia(reel, numbers(100, { skipRate: 0.25 }))
      .seedMedia(photo, numbers(40, { skipRate: 0.5 }));
    const run = (hours: number, callsLeft = 50) =>
      readMediaInsights({ instagram, store }, { creatorId: nora, now: hoursAfter(hours), callsLeft });

    expect(await run(2)).toEqual({ read: 2, missed: 0, deferred: 0, failed: false });
    expect(await run(3)).toEqual({ read: 0, missed: 0, deferred: 0, failed: false });
    expect(await steps(nora)).toEqual([
      ['photo-1', '1h', 40],
      ['reel-1', '1h', 100],
    ]);
    const kept = await rows();
    // The skip rate is a Reel's: never kept of a photo, whatever the adapter answers.
    expect(kept.map((row) => [row.mediaRef, row.skipRate, row.reposts])).toEqual([
      ['photo-1', null, null],
      ['reel-1', 0.25, null],
    ]);
    expect(kept[0]).not.toHaveProperty('caption');

    // Three days later, no run in between: 24 h is missed without a number, 48 h is read, 1 h is left as it was.
    instagram.setNumbers(reel.ref, numbers(900)).setNumbers(photo.ref, numbers(90));
    // One call for the listing, one reading left: the most recent first, the other waits.
    expect(await run(72, 2)).toEqual({ read: 1, missed: 2, deferred: 1, failed: false });
    expect(await run(73)).toEqual({ read: 1, missed: 0, deferred: 0, failed: false });
    expect((await steps(nora)).filter(([ref]) => ref === 'reel-1')).toEqual([
      ['reel-1', '1h', 100],
      ['reel-1', '24h', null],
      ['reel-1', '48h', 900],
    ]);
  });

  it('keeps what was read when Instagram fails, and calls nothing without a call left', async () => {
    const store = createDrizzleMediaInsightStore(test.app.db);
    const instagram = new FakeInstagramInsights().seedMedia(reel, numbers(5000));
    const before = await rows();
    instagram.failWith(new Error('instagram unavailable'));
    expect(
      await readMediaInsights(
        { instagram, store },
        { creatorId: nora, now: hoursAfter(24 * 8), callsLeft: 50 },
      ),
    ).toEqual({ read: 0, missed: 0, deferred: 0, failed: true });
    expect(await rows()).toEqual(before);
    instagram.restore();
    const calls = instagram.calls.length;
    await readMediaInsights({ instagram, store }, { creatorId: nora, now: hoursAfter(24 * 8), callsLeft: 0 });
    expect(instagram.calls).toHaveLength(calls);
  });

  it('marks missed the last step of a media Instagram no longer lists', async () => {
    const store = createDrizzleMediaInsightStore(test.app.db);
    // A month later her media are out of the listing: no call reads them, their last step is kept missed.
    const instagram = new FakeInstagramInsights();
    const run = await readMediaInsights(
      { instagram, store },
      { creatorId: nora, now: hoursAfter(24 * 30), callsLeft: 50 },
    );
    expect(run).toEqual({ read: 0, missed: 2, deferred: 0, failed: false });
    expect(instagram.calls.filter((call) => call.method === 'readInsights')).toEqual([]);
    expect((await steps(nora)).map(([ref, age, views]) => [ref, age, views === null])).toEqual([
      ['photo-1', '1h', false],
      ['photo-1', '24h', true],
      ['photo-1', '48h', false],
      ['photo-1', '7d', true],
      ['reel-1', '1h', false],
      ['reel-1', '24h', true],
      ['reel-1', '48h', false],
      ['reel-1', '7d', true],
    ]);
    expect(await store.keptOf(nora, hoursAfter(24 * 30))).toEqual([]);
  });

  it('lets the job read and add steps in the creator it is in, never in another, and change none', async () => {
    const kept = (await rows()).length;
    expect((await withTenantJob(test.app.db, nora, 'media_insights', count)).rows[0]?.n).toBe(kept);
    expect((await withTenantJob(test.app.db, ines, 'media_insights', count)).rows[0]?.n).toBe(0);
    // Another job's name, or none, opens nothing.
    expect((await withTenantJob(test.app.db, nora, 'daily_stats', count)).rows[0]?.n).toBe(0);
    expect((await withTenant(test.app.db, nora, count)).rows[0]?.n).toBe(0);

    const insert = (tx: Transaction) =>
      tx.insert(schema.mediaInsightSnapshots).values(step(nora, 'reel-other'));
    await expect(withTenantJob(test.app.db, ines, 'media_insights', insert)).rejects.toThrow();
    await expect(withTenantJob(test.app.db, nora, 'daily_stats', insert)).rejects.toThrow();
    await expect(withTenant(test.app.db, nora, insert)).rejects.toThrow();
    // Even in her creator the job has no right to change or remove a step.
    await expect(
      withTenantJob(test.app.db, nora, 'media_insights', (tx) =>
        tx.execute(sql`update media_insight_snapshots set views = 9 where not missed`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantJob(test.app.db, nora, 'media_insights', (tx) =>
        tx.execute(sql`delete from media_insight_snapshots`),
      ),
    ).rejects.toThrow();

    // The other creator's run lands in hers alone.
    const store = createDrizzleMediaInsightStore(test.app.db);
    const instagram = new FakeInstagramInsights().seedMedia(reel, numbers(7));
    await readMediaInsights({ instagram, store }, { creatorId: ines, now: hoursAfter(2), callsLeft: 50 });
    expect(await steps(ines)).toEqual([['reel-1', '1h', 7]]);
    expect((await rows()).filter((row) => row.creatorId === nora)).toHaveLength(kept);
  });

  it('shows the steps to the owner and to a manager whose list has her, and lets no account write', async () => {
    const read = async (userId: string) =>
      (await withTenantMember(test.app.db, nora, userId, count)).rows[0]?.n;
    expect(await read(users.owner)).toBe(8);
    expect(await read(users.manager)).toBe(8);
    expect(await read(users.outsideManager)).toBe(0);
    expect(await read(users.chatter)).toBe(0);
    expect(await read(users.creator)).toBe(0);
    await expect(
      withTenantMember(test.app.db, nora, users.owner, (tx) =>
        tx.insert(schema.mediaInsightSnapshots).values(step(nora, 'reel-owner')),
      ),
    ).rejects.toThrow();
  });

  it('writes nothing on the service connection, and refuses a missed step that carries a number', async () => {
    await expect(
      test.service.db.insert(schema.mediaInsightSnapshots).values(step(nora, 'reel-service')),
    ).rejects.toThrow();
    await expect(test.service.db.execute(sql`delete from media_insight_snapshots`)).rejects.toThrow();
    await expect(
      test.admin.db.insert(schema.mediaInsightSnapshots).values({ ...step(nora, 'reel-check'), views: 3 }),
    ).rejects.toThrow();
    await expect(
      test.admin.db
        .insert(schema.mediaInsightSnapshots)
        .values({ ...step(nora, 'reel-check'), missed: false, views: 3 }),
    ).rejects.toThrow();
  });
});
