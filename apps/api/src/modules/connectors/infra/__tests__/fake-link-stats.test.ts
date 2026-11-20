import { LinkRefSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { hoursWithoutRobots } from '../../domain/link-stats';
import { FakeLinkStats } from '../fake/FakeLinkStats';

const link = LinkRefSchema.parse('lien-inventé-1');
const other = LinkRefSchema.parse('lien-inventé-2');
const range = { from: new Date('2026-11-16T00:00:00Z'), to: new Date('2026-11-17T00:00:00Z') };

describe('FakeLinkStats (ADR 0120 § 3)', () => {
  it('reads back the hours and robot visits of one link, inside the range only', async () => {
    const fake = new FakeLinkStats()
      .seedHours(link, [
        { hour: '2026-11-16T13:00:00.000Z', pageviews: 6, clicks: 2 },
        { hour: '2026-11-17T00:00:00.000Z', pageviews: 9, clicks: 9 },
      ])
      .seedHours(other, [{ hour: '2026-11-16T13:00:00.000Z', pageviews: 50, clicks: 5 }])
      .seedRobotVisits(link, [new Date('2026-11-16T13:20:00Z'), new Date('2026-11-15T23:59:00Z')]);
    const totals = hoursWithoutRobots(
      await fake.readHours(link, range),
      await fake.readRobotVisits(link, range),
    );
    expect(totals).toEqual([{ hour: '2026-11-16T13:00:00.000Z', pageviews: 5, clicks: 2, robots: 1 }]);
    expect(fake.calls.map((call) => call.method)).toEqual(['readHours', 'readRobotVisits']);
  });

  it('fails every call during an outage, and answers again once restored', async () => {
    const fake = new FakeLinkStats().seedHours(link, []).failWith(new Error('service injoignable'));
    await expect(fake.readHours(link, range)).rejects.toThrow('service injoignable');
    await expect(fake.readRobotVisits(link, range)).rejects.toThrow('service injoignable');
    await expect(fake.restore().readHours(link, range)).resolves.toEqual([]);
  });

  it('lists the links of the account, and fails like the rest during an outage', async () => {
    const found = { ref: link, name: 'Story du jour', url: 'https://liens.example/jour' };
    const fake = new FakeLinkStats().seedLinks(found);
    expect(await fake.listLinks()).toEqual([found]);
    await expect(fake.failWith(new Error('service injoignable')).listLinks()).rejects.toThrow();
  });

  it('has nothing that writes to the service', () => {
    const methods = Object.getOwnPropertyNames(FakeLinkStats.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(methods.filter((name) => !/^(read|list|seed|failWith$|restore$)/u.test(name))).toEqual([]);
  });
});
