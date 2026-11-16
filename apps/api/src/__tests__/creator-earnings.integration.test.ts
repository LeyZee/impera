import {
  calendarDayAt,
  CreatorEarningsSchema,
  CreatorIdSchema,
  newId,
  payPeriodOfDay,
  PlatformAccountIdSchema,
  previousPayPeriod,
  SalesLineIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const URL = '/v1/creator-space/earnings';

/**
 * Her share read by the creator (ADR 0106 amendment of 16/11, § 15 to § 20): the fortnight in course and the one
 * before, her days in her own zone, net of refunds, her own sales only and nothing but her share. Invented data only
 * (ADR 0010).
 */
describe('GET /v1/creator-space/earnings', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let noraCookie: string;
  let inesCookie: string;
  let operatorCookie: string;
  let today: string;
  let previous: string;
  let current: string;

  const get = (cookie: string) =>
    server.inject({ method: 'GET', url: URL, headers: { cookie, origin: DASHBOARD_ORIGIN } });

  async function account(email: string, set: { role: 'creator' | 'operator'; creatorIds: string[] }) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return signIn(server, email, PASSWORD);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config), { composer: fixedComposer });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const seeded: { creatorId: CreatorId; accountId: string }[] = [];
    for (const [label, timezone] of [
      ['nora', 'Europe/Paris'],
      ['ines', 'Asia/Tokyo'],
    ] as const) {
      const creatorId = newId(CreatorIdSchema);
      const accountId = newId(PlatformAccountIdSchema);
      await test.admin.db
        .insert(schema.creators)
        .values({ id: creatorId, nameKey: creatorId, displayName: label, timezone });
      await test.admin.db
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId, platform: 'reveal', handle: `${label}-reveal` });
      seeded.push({ creatorId, accountId });
    }
    const [nora, ines] = seeded;
    if (nora === undefined || ines === undefined) throw new Error('seed failed');
    const now = new Date();
    today = calendarDayAt(now, 'Europe/Paris');
    previous = previousPayPeriod(payPeriodOfDay(today));
    const line = (
      creator: typeof nora,
      platformSaleId: string,
      occurredAt: Date,
      creatorMinor: number,
      event: 'sale' | 'refund' = 'sale',
    ) => ({
      id: newId(SalesLineIdSchema),
      creatorId: creator.creatorId,
      platformAccountId: creator.accountId,
      platform: 'reveal' as const,
      platformSaleId,
      event,
      saleType: 'ppv' as const,
      status: event === 'sale' ? ('paid' as const) : ('refunded' as const),
      occurredAt,
      platformModelId: 'model_test_01',
      platformChatterId: null,
      platformFanId: 'fan_test_01',
      currency: 'EUR' as const,
      grossInclVatMinor: creatorMinor * 2,
      grossExclVatMinor: creatorMinor * 2,
      netMinor: creatorMinor * 2,
      agencyMinor: creatorMinor,
      creatorMinor,
      position: `${platformSaleId}-${event}`,
      inputsHash: `hash-${platformSaleId}-${event}`,
    });
    const minuteAgo = new Date(now.getTime() - 60_000);
    // Noon in Paris on the first day of the fortnight before, whatever the season.
    const beforeAt = new Date(`${previous}T10:00:00Z`);
    // 21:00 UTC the eve of the fortnight in course: 22:00 or 23:00 in Paris, still the fortnight before for pay; 06:00
    // the next morning in Tokyo, her first day of the fortnight in course.
    current = payPeriodOfDay(today);
    const nearBound = new Date(Date.parse(`${current}T00:00:00Z`) - 3 * 3_600_000);
    await test.admin.db.insert(schema.platformSales).values([
      line(nora, 'sale_earn_01', minuteAgo, 500),
      line(nora, 'sale_earn_02', minuteAgo, 300),
      line(nora, 'sale_earn_02', minuteAgo, 300, 'refund'),
      line(nora, 'sale_earn_03', beforeAt, 1_200),
      // Another creator's: never hers to see.
      line(ines, 'sale_earn_04', minuteAgo, 9_900),
      line(ines, 'sale_earn_05', nearBound, 700),
    ]);
    noraCookie = await account('nora@example.test', { role: 'creator', creatorIds: [nora.creatorId] });
    inesCookie = await account('ines@example.test', { role: 'creator', creatorIds: [ines.creatorId] });
    operatorCookie = await account('ope@example.test', { role: 'operator', creatorIds: [nora.creatorId] });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives her share of the fortnight in course and the one before, net of refunds, in her zone', async () => {
    const response = await get(noraCookie);
    expect(response.statusCode, response.body).toBe(200);
    const body = CreatorEarningsSchema.parse(response.json());
    expect([body.timeZone, body.today]).toEqual(['Europe/Paris', today]);
    const [inCourse, before] = body.periods;
    expect([inCourse?.from, inCourse?.to]).toEqual([payPeriodOfDay(today), today]);
    expect(inCourse?.totals).toEqual([
      { currency: 'EUR', shareMinor: 500, sales: 2, refunds: 1, refundedMinor: 300 },
    ]);
    expect(inCourse?.days).toEqual([
      { day: today, sums: [{ currency: 'EUR', shareMinor: 500, sales: 2, refunds: 1, refundedMinor: 300 }] },
    ]);
    expect(before?.from).toBe(previous);
    expect(before?.days).toEqual([
      {
        day: previous,
        sums: [{ currency: 'EUR', shareMinor: 1_200, sales: 1, refunds: 0, refundedMinor: 0 }],
      },
    ]);
    // Nothing but her share: no agency share, net, price, fan nor sale.
    expect(response.body).not.toMatch(/agency|net|gross|fan|sale_earn/iu);
  });

  it('gives each creator her own sales only, in pay’s fortnights, each on her own day', async () => {
    const response = await get(inesCookie);
    expect(response.statusCode, response.body).toBe(200);
    const body = CreatorEarningsSchema.parse(response.json());
    expect(body.timeZone).toBe('Asia/Tokyo');
    const [inCourse, before] = body.periods;
    expect(inCourse?.totals).toEqual([
      { currency: 'EUR', shareMinor: 9_900, sales: 1, refunds: 0, refundedMinor: 0 },
    ]);
    // The sale on the eve of the bound stays in pay's fortnight before, said on her day in Tokyo, one past its end.
    expect(before?.totals).toEqual([
      { currency: 'EUR', shareMinor: 700, sales: 1, refunds: 0, refundedMinor: 0 },
    ]);
    expect(before?.days.map((day) => day.day)).toEqual([current]);
  });

  it('is for a creator’s account only', async () => {
    const response = await get(operatorCookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'role_forbidden' } });
  });
});
