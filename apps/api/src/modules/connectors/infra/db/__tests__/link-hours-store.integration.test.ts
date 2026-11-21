import { CreatorIdSchema, LinkRefSchema, newId, RedirectLinkIdSchema } from '@impera/contracts';
import { schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { readLinkHours } from '../../../application/link-hours';
import { LinkServiceError } from '../../../domain/link-service';
import { FakeLinkStats } from '../../fake/FakeLinkStats';
import { createDrizzleLinkHourStore } from '../link-hours-store';

// Everything below is invented (ADR 0010).
const ref = (n: number) => LinkRefSchema.parse(`lnk_${String(n).padStart(24, '0')}`);
const at = (time: string) => new Date(`2026-11-16T${time}Z`);
const hour = (start: string) => `2026-11-16T${start}:00:00.000Z`;

/**
 * The hourly reading of her redirect links, kept in the base (ADR 0120 § 3): the run against the fake service, the
 * hours replaced then frozen, and whose links a run reads.
 */
describe('the hours of her redirect links, kept by the hourly reading', () => {
  let test: TestDb;
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraStory = newId(RedirectLinkIdSchema);
  const inesStory = newId(RedirectLinkIdSchema);
  const kept = async (linkId: string) =>
    (await test.admin.db.select().from(schema.redirectLinkHours).orderBy(schema.redirectLinkHours.hour))
      .filter((row) => row.linkId === linkId && (row.pageviews > 0 || row.clicks > 0 || row.robots > 0))
      .map((row) => [row.hour.toISOString(), row.pageviews, row.clicks, row.robots, row.closed]);
  const countOf = async (linkId: string) =>
    (await test.admin.db.select().from(schema.redirectLinkHours)).filter((row) => row.linkId === linkId)
      .length;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: ines, nameKey: 'ines', displayName: 'Ines', timezone: 'Europe/Paris' },
    ]);
    const link = (id: string, creatorId: string, name: string, more: object = {}) => ({
      id,
      creatorId,
      name,
      url: `https://liens.example/${id.slice(-8)}`,
      placement: 'story_daily',
      ...more,
    });
    await test.admin.db
      .insert(schema.redirectLinks)
      .values([
        link(noraStory, nora, 'Story du jour', { serviceRef: ref(1) }),
        link(newId(RedirectLinkIdSchema), nora, 'Pas relié'),
        link(newId(RedirectLinkIdSchema), nora, 'Éteint', { serviceRef: ref(2), enabled: false }),
        link(newId(RedirectLinkIdSchema), nora, 'Sans endroit', { serviceRef: ref(3), placement: null }),
        link(inesStory, ines, 'Story du jour', { serviceRef: ref(4) }),
      ]);
  });

  afterAll(async () => {
    await test.close();
  });

  it('reads her attached links only, keeps every hour of the window, and replaces an open hour', async () => {
    const store = createDrizzleLinkHourStore(test.app.db);
    const stats = new FakeLinkStats()
      .seedHours(ref(1), [
        { hour: hour('11'), pageviews: 10, clicks: 3 },
        { hour: hour('13'), pageviews: 2, clicks: 1 },
      ])
      .seedRobotHours(ref(1), [{ hour: hour('11'), robots: 4 }])
      .seedHours(ref(4), [{ hour: hour('11'), pageviews: 50, clicks: 5 }]);
    const run = (now: Date, callsLeft = 30) =>
      readLinkHours({ stats, store }, { creatorId: nora, now, callsLeft });

    expect(await run(at('13:20:00'))).toEqual({
      links: 1,
      hours: 47,
      deferred: 0,
      calls: 3,
      failed: false,
      retryAfterSeconds: null,
    });
    // Her one attached link that is on and placed, and never a link of Inès.
    expect(stats.calls.map((call) => call.link)).toEqual([ref(1), ref(1)]);
    expect(await countOf(noraStory)).toBe(47);
    expect(await countOf(inesStory)).toBe(0);
    expect(await kept(noraStory)).toEqual([
      [hour('11'), 6, 3, 4, true],
      [hour('13'), 2, 1, 0, false],
    ]);

    // Later in the same hour the service counts more: the open hour is replaced, the closed one is not touched.
    stats.seedHours(ref(1), [
      { hour: hour('11'), pageviews: 100, clicks: 100 },
      { hour: hour('13'), pageviews: 5, clicks: 0 },
    ]);
    const again = await run(at('13:50:00'));
    expect(again.hours).toBe(1);
    expect(await kept(noraStory)).toEqual([
      [hour('11'), 6, 3, 4, true],
      [hour('13'), 7, 1, 0, false],
    ]);
    expect(await countOf(noraStory)).toBe(47);
  });

  it('writes nothing and removes nothing when the service fails, and says how long it asked to wait', async () => {
    const store = createDrizzleLinkHourStore(test.app.db);
    const before = await kept(noraStory);
    const stats = new FakeLinkStats().failWith(new LinkServiceError('rate_limited', 42));
    const run = await readLinkHours(
      { stats, store },
      { creatorId: nora, now: at('14:30:00'), callsLeft: 30 },
    );
    expect(run).toEqual({ links: 0, hours: 0, deferred: 1, calls: 2, failed: true, retryAfterSeconds: 42 });
    expect(await kept(noraStory)).toEqual(before);
  });

  it('reads no link at all without the calls for a whole one', async () => {
    const store = createDrizzleLinkHourStore(test.app.db);
    const stats = new FakeLinkStats();
    const run = await readLinkHours({ stats, store }, { creatorId: nora, now: at('14:30:00'), callsLeft: 2 });
    expect(run).toMatchObject({ links: 0, deferred: 1, calls: 0, failed: false });
    expect(stats.calls).toEqual([]);
  });
});
