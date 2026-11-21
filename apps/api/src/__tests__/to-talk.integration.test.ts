import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  ToTalkSchema,
  type CreatorId,
  type FanId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const DAY = 86_400_000;

/**
 * « À qui parler maintenant » through the real app (Charles, 21/11): what each fan paid read from the register (sales
 * less refunds), his tier from her thresholds, the three groups, the doubts on age counted, and the owner alone sets
 * the thresholds. Everything is invented (ADR 0010).
 */
describe('GET /v1/conversations/to-talk and PUT /v1/creators/:id/fan-tiers', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  const cookies = new Map<'owner' | 'manager', string>();
  const now = Date.now();
  let position = 0;

  async function fan(
    platformFanId: string,
    displayName: string,
    firstSeenDaysAgo: number,
    flags: object = {},
  ) {
    const id = newId(FanIdSchema);
    await test.admin.db.insert(schema.fans).values({
      id,
      creatorId,
      platformAccountId: accountId,
      platformFanId,
      displayName,
      flags,
      firstSeenAt: new Date(now - firstSeenDaysAgo * DAY),
    });
    return id;
  }

  async function conversation(fanId: FanId, inboundDaysAgo: number | null, outboundDaysAgo: number | null) {
    await test.admin.db.insert(schema.conversations).values({
      id: newId(ConversationIdSchema),
      creatorId,
      platformAccountId: accountId,
      fanId,
      platformConversationId: `conv_${fanId}`,
      mode: 'copilot',
      state: 'idle',
      lastInboundAt: inboundDaysAgo === null ? null : new Date(now - inboundDaysAgo * DAY),
      lastOutboundAt: outboundDaysAgo === null ? null : new Date(now - outboundDaysAgo * DAY),
    });
  }

  async function sale(
    platformFanId: string,
    saleId: string,
    gross: number,
    event: 'sale' | 'refund' = 'sale',
  ) {
    position += 1;
    await test.admin.db.insert(schema.platformSales).values({
      id: newId(SalesLineIdSchema),
      creatorId,
      platformAccountId: accountId,
      platform: 'reveal',
      platformSaleId: saleId,
      event,
      saleType: 'ppv',
      status: event === 'refund' ? 'refunded' : 'paid',
      occurredAt: new Date(now - 2 * DAY),
      platformModelId: 'model_test_01',
      platformChatterId: null,
      platformFanId,
      currency: 'EUR',
      grossInclVatMinor: gross,
      grossExclVatMinor: Math.round((gross * 5) / 6),
      netMinor: Math.round((gross * 2) / 3),
      agencyMinor: Math.round(gross / 4),
      creatorMinor: Math.round((gross * 2) / 3) - Math.round(gross / 4),
      position: String(position).padStart(6, '0'),
      inputsHash: `hash-${saleId}-${event}`,
    });
  }

  const toTalk = async (who: 'owner' | 'manager' = 'owner') => {
    const answer = await server.inject({
      method: 'GET',
      url: `/v1/conversations/to-talk?creatorId=${creatorId}`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
    });
    expect(answer.statusCode, answer.body).toBe(200);
    return ToTalkSchema.parse(answer.json());
  };
  const setTiers = (who: 'owner' | 'manager', body: object) =>
    server.inject({
      method: 'PUT',
      url: `/v1/creators/${creatorId}/fan-tiers`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
      payload: body,
    });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    creatorId = newId(CreatorIdSchema);
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: 'creatrice_test' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: 'manager@example.test',
      name: 'manager',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, userId));
    cookies.set('manager', await signIn(server, 'manager@example.test', PASSWORD));

    // Arnaud: 600 € paid, waiting for an answer. Basile: 30 €, then 10 € refunded, waiting.
    await conversation(await fan('fan_a', 'Arnaud', 90), 0.01, 1);
    await sale('fan_a', 's_a', 60_000);
    await conversation(await fan('fan_b', 'Basile', 90), 0.02, 1);
    await sale('fan_b', 's_b1', 3_000);
    await sale('fan_b', 's_b2', 1_000);
    await sale('fan_b', 's_b2', 1_000, 'refund');
    // Côme: arrived yesterday, never answered. Damien: 250 €, quiet for six days.
    await conversation(await fan('fan_c', 'Côme', 1), 0.5, null);
    await conversation(await fan('fan_d', 'Damien', 120), 6, 6.5);
    await sale('fan_d', 's_d', 25_000);
    // Émile: his age in doubt, waiting: counted, never listed.
    await conversation(
      await fan('fan_e', 'Émile', 30, {
        ageDisputed: { since: new Date(now - DAY).toISOString(), by: 'policy' },
      }),
      0.1,
      1,
    );
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the payers who wait, the new ones and the quiet big payers, with what each spent', async () => {
    const result = await toTalk();
    expect(result.waiting.map((f) => [f.fanDisplayName, f.tier, f.spentMinor])).toEqual([
      ['Arnaud', 'whale', 60_000],
      ['Basile', 'payer', 3_000],
    ]);
    expect(result.newcomers.map((f) => f.fanDisplayName)).toEqual(['Côme']);
    expect(result.silent.map((f) => [f.fanDisplayName, f.tier])).toEqual([['Damien', 'very_good']]);
    expect(result.ageHeld).toBe(1);
  });

  it('lets the owner alone move the thresholds, and reads them at once', async () => {
    expect(
      (await setTiers('manager', { goodFromMinor: 2_000, veryGoodFromMinor: 9_000, whaleFromMinor: 90_000 }))
        .statusCode,
    ).toBe(403);
    expect(
      (await setTiers('owner', { goodFromMinor: 9_000, veryGoodFromMinor: 2_000, whaleFromMinor: 90_000 }))
        .statusCode,
    ).toBe(400);
    const set = await setTiers('owner', {
      goodFromMinor: 2_000,
      veryGoodFromMinor: 9_000,
      whaleFromMinor: 90_000,
    });
    expect(set.statusCode, set.body).toBe(200);
    const result = await toTalk('manager');
    expect(result.waiting.map((f) => [f.fanDisplayName, f.tier])).toEqual([
      ['Arnaud', 'very_good'],
      ['Basile', 'good'],
    ]);
  });
});
