import { schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { fetchExchangeRates } from '../application/exchange-rates';
import type { JobLogger, RateJobSince } from '../domain/ports';
import { createEcbSource, type GetLike } from '../infra/ecb';
import { createPostgresRateAlerts } from '../infra/rate-alerts';
import { createDrizzlePayrollRateStore } from '../infra/rate-store';

/** The ECB's file as it is laid out, with the days given (newest first, as the ECB writes them). */
const fileOf = (days: readonly (readonly [string, string])[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<Cube>
${days
  .map(
    ([day, usd]) =>
      `		<Cube time='${day}'>\n			<Cube currency='USD' rate='${usd}'/>\n			<Cube currency='JPY' rate='172.65'/>\n		</Cube>`,
  )
  .join('\n')}
	</Cube>
</gesmes:Envelope>`;

/** The job against a fake ECB and the real `exchange_rates` (ADR 0033). */
describe('payroll.fetch_exchange_rates', () => {
  let test: TestDb;
  let file = '';
  let down = false;
  const errors: object[] = [];
  const logger: JobLogger = {
    warn: () => undefined,
    error: (object) => {
      errors.push(object);
    },
  };
  const fetch: GetLike = () =>
    down ? Promise.reject(new Error('network down')) : Promise.resolve(new Response(file, { status: 200 }));
  const run = (at = '2025-10-03T15:07:00.000Z', since: RateJobSince | null = null) =>
    fetchExchangeRates(
      {
        source: createEcbSource({ fetch }),
        store: createDrizzlePayrollRateStore(test.admin.db),
        alerts: createPostgresRateAlerts(test.admin.db),
        since,
        now: () => new Date(at),
      },
      logger,
    );
  const alerts = () =>
    test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(sql`${schema.domainEvents.type} = 'exchange_rate_overdue'`)
      .orderBy(sql`${schema.domainEvents.createdAt}`);
  const stored = () =>
    test.admin.db
      .select()
      .from(schema.exchangeRates)
      .orderBy(sql`${schema.exchangeRates.day}`);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(() => test.close());

  it('tells the owner in production only when no rate ever came, counted from the job’s first schedule', async () => {
    // The job was first scheduled on Monday 29 September 2025 at 10:00 in Frankfurt, and the ECB was never reached.
    const production: RateJobSince = () => Promise.resolve(new Date('2025-09-29T08:00:00.000Z'));
    down = true;
    // Wednesday 1 October: one weekday without a rate.
    await expect(run('2025-10-01T09:07:00.000Z', production)).rejects.toThrow('network down');
    // Outside production a database without rates is the normal case: nothing on Friday 3 October, the third weekday,
    // nor a month later.
    await expect(run('2025-10-03T09:07:00.000Z')).rejects.toThrow('network down');
    await expect(run('2025-10-31T09:07:00.000Z')).rejects.toThrow('network down');
    expect(await alerts()).toEqual([]);
    await expect(run('2025-10-03T09:07:00.000Z', production)).rejects.toThrow('network down');
    await expect(run('2025-10-03T10:07:00.000Z', production)).rejects.toThrow('network down');
    expect(await alerts()).toEqual([
      expect.objectContaining({
        creatorId: null,
        actor: 'system',
        correlationId: 'exchange_rate:USD:2025-10-03',
        payload: { currency: 'USD', lastRateDay: null, day: '2025-10-03' },
      }),
    ]);
    down = false;
  });

  it('writes each day of the dollar once, in euros for one dollar, and nothing of a currency pay does not use', async () => {
    file = fileOf([
      ['2025-10-03', '1.1734'],
      ['2025-10-02', '1.1708'],
      ['2025-10-01', '1.1741'],
    ]);
    expect(await run()).toEqual({ read: 3, written: 3, alerted: [] });
    expect(await stored()).toEqual([
      expect.objectContaining({ currency: 'USD', day: '2025-10-01', rateMicros: 851_716 }),
      expect.objectContaining({ currency: 'USD', day: '2025-10-02', rateMicros: 854_117 }),
      expect.objectContaining({
        currency: 'USD',
        day: '2025-10-03',
        rateMicros: 852_224,
        source: 'BCE, taux de référence',
        fetchedAt: new Date('2025-10-03T15:07:00.000Z'),
      }),
    ]);
    expect(await run('2025-10-03T16:07:00.000Z')).toEqual({ read: 3, written: 0, alerted: [] });
    expect(errors).toEqual([]);
  });

  it('fills in the days a stopped job missed, and never changes a day once written', async () => {
    file = fileOf([
      ['2025-10-08', '1.1650'],
      ['2025-10-07', '1.1660'],
      ['2025-10-06', '1.1700'],
      ['2025-10-03', '1.1734'],
      ['2025-10-02', '1.1999'],
      ['2025-10-01', '1.1741'],
    ]);
    expect(await run('2025-10-08T15:07:00.000Z')).toEqual({ read: 6, written: 3, alerted: [] });
    const rows = await stored();
    expect(rows.map((row) => row.day)).toEqual([
      '2025-10-01',
      '2025-10-02',
      '2025-10-03',
      '2025-10-06',
      '2025-10-07',
      '2025-10-08',
    ]);
    // The 2nd of October keeps the rate first written; the job says the ECB now gives another one.
    expect(rows.find((row) => row.day === '2025-10-02')?.rateMicros).toBe(854_117);
    expect(errors).toEqual([{ days: ['USD 2025-10-02'] }]);
  });

  it('writes nothing when the ECB cannot be reached or its file is out of format, and says so', async () => {
    const before = await stored();
    down = true;
    await expect(run()).rejects.toThrow('network down');
    down = false;
    file = fileOf([['2025-10-09', '1,1650']]);
    await expect(run()).rejects.toThrow();
    file = '<html><body>Maintenance</body></html>';
    await expect(run()).rejects.toThrow('no rate');
    expect(await stored()).toEqual(before);
  });

  it('tells the owner once a day, per currency, when no rate came for more than two weekdays', async () => {
    // The last rate is Wednesday 8 October 2025's; the ECB stays out of reach.
    down = true;
    // Monday 13: Thursday and Friday are missing, which a long weekend can be. Only the first test's alert is there.
    await expect(run('2025-10-13T09:07:00.000Z')).rejects.toThrow('network down');
    expect(await alerts()).toHaveLength(1);
    // Tuesday 14: a third weekday, and two workers at the same hour.
    const tuesday = await Promise.allSettled([
      run('2025-10-14T09:07:00.000Z'),
      run('2025-10-14T09:07:00.000Z'),
    ]);
    expect(tuesday.map((one) => one.status)).toEqual(['rejected', 'rejected']);
    await expect(run('2025-10-14T10:07:00.000Z')).rejects.toThrow('network down');
    // Wednesday 15, just after midnight in Frankfurt: the alert comes back.
    await expect(run('2025-10-14T22:07:00.000Z')).rejects.toThrow('network down');
    expect((await alerts()).slice(1)).toEqual([
      expect.objectContaining({
        creatorId: null,
        actor: 'system',
        correlationId: 'exchange_rate:USD:2025-10-14',
        payload: { currency: 'USD', lastRateDay: '2025-10-08', day: '2025-10-14' },
      }),
      expect.objectContaining({
        creatorId: null,
        payload: { currency: 'USD', lastRateDay: '2025-10-08', day: '2025-10-15' },
      }),
    ]);
    // The ECB answers again with Wednesday's rate: written, and nothing rings.
    down = false;
    file = fileOf([
      ['2025-10-15', '1.1610'],
      ['2025-10-08', '1.1650'],
    ]);
    expect(await run('2025-10-15T15:07:00.000Z')).toEqual({ read: 2, written: 1, alerted: [] });
    expect(await alerts()).toHaveLength(3);
  });
});
