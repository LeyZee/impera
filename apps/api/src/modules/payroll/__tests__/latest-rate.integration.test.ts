import { newId, UserIdSchema } from '@nirvana/contracts';
import { schema, sql, withAdmin } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createLatestRateRead, latestRateOf } from '../infra/latest-rate';

/** The last rate known, on the application role and under the reader's member context (policy `team_read`). */
describe('latestRate', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(() => test.close());

  it('gives the newest day of the currency, null before the first, to any member scope', async () => {
    // An account with no team row: the scope `self`, the narrowest one.
    const latest = createLatestRateRead(test.app.db);
    const reader = newId(UserIdSchema);
    expect(await latest(reader, 'USD')).toBeNull();

    const rate = (day: string, rateMicros: number) => ({
      currency: 'USD',
      day,
      rateMicros,
      source: 'BCE, taux de référence',
      fetchedAt: new Date('2026-10-27T15:07:00.000Z'),
    });
    await test.admin.db
      .insert(schema.exchangeRates)
      .values([rate('2026-10-23', 870_000), rate('2026-10-27', 893_815)]);

    expect(await latest(reader, 'USD')).toMatchObject({
      currency: 'USD',
      day: '2026-10-27',
      rateMicros: 893_815,
    });
    // A sale's day (Telegram's minimum, CRM-04): the newest rate of that day or before, none before the first.
    const onOrBefore = (day: string) => withAdmin(test.admin.db, (tx) => latestRateOf(tx, 'USD', day));
    expect(await onOrBefore('2026-10-26')).toMatchObject({ day: '2026-10-23', rateMicros: 870_000 });
    expect(await onOrBefore('2026-10-27')).toMatchObject({ day: '2026-10-27' });
    expect(await onOrBefore('2026-10-22')).toBeNull();
  });

  it('reads nothing outside a member context: the policy is not widened', async () => {
    const rows = await test.app.db.execute(sql`select count(*)::int as n from exchange_rates`);
    expect(rows.rows).toEqual([{ n: 0 }]);
  });
});
