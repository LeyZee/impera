import { randomUUID } from 'node:crypto';

import {
  CreatorFanInsightsSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  FanIdSchema,
  type FanId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
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
const DAY = 24 * 60 * 60 * 1000;

/**
 * « Qui sont tes fans » (CR-15, ADR 0065, ADR 0074): shares on all her fans, from declared facts active at midnight
 * in her time zone, one per fan and key, never a value a fan wrote nor a case's count. Invented data only (ADR 0010).
 */
describe('GET /v1/creator-space/fan-insights', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let noraCookie: string;
  let inesCookie: string;
  let operatorCookie: string;
  let nora: CreatorId;
  const fans: FanId[] = [];
  const longAgo = new Date(Date.now() - 3 * DAY);
  const yesterday = new Date(Date.now() - 2 * DAY);

  const get = (cookie: string) =>
    server.inject({
      method: 'GET',
      url: '/v1/creator-space/fan-insights',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });

  async function seedCreator(label: string) {
    const creatorId = newId(CreatorIdSchema);
    const accountId = PlatformAccountIdSchema.parse(newId(PlatformAccountIdSchema));
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: label, timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: `h-${label}` });
    return { creatorId, accountId };
  }

  async function fact(input: {
    fanId: FanId;
    key: string;
    value: string;
    kind?: 'declared' | 'inferred';
    category?: 'identity' | 'life' | 'operator_note' | 'commercial';
    createdAt?: Date;
    observedAt?: Date;
  }): Promise<string> {
    const [row] = await test.admin.db
      .insert(schema.fanFacts)
      .values({
        id: randomUUID(),
        creatorId: nora,
        fanId: input.fanId,
        category: input.category ?? 'identity',
        key: input.key,
        value: input.value,
        kind: input.kind ?? 'declared',
        confidence: 0.9,
        observedAt: input.observedAt ?? input.createdAt ?? yesterday,
        createdAt: input.createdAt ?? yesterday,
      })
      .returning({ id: schema.fanFacts.id });
    if (row === undefined) throw new Error('fact not written');
    return row.id;
  }

  async function account(email: string, set: { role: 'creator' | 'operator'; creatorIds: string[] }) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return signIn(server, email, PASSWORD);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), { composer: fixedComposer });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const a = await seedCreator('Nora');
    const b = await seedCreator('Ines');
    nora = a.creatorId;
    for (let i = 0; i < 13; i += 1) {
      const result = await app.modules.conversations.ingestMessage({
        creatorId: nora,
        platformAccountId: a.accountId,
        platformConversationId: `c-${String(i)}`,
        platformFanId: `f-${String(i)}`,
        fanDisplayName: `Fan inventé ${String(i)}`,
        message: {
          ref: { platform: 'reveal', id: `in-${String(i)}` },
          conversationRef: { platform: 'reveal', id: `c-${String(i)}` },
          direction: 'inbound',
          text: 'Coucou',
          media: [],
          priceMinor: null,
          currency: null,
          isPaid: false,
          createdAt: yesterday.toISOString(),
        },
        correlationId: 'seed',
      });
      // Six of them unlocked a 30 € message.
      if (i < 6)
        await app.modules.conversations.ingestMessage({
          creatorId: nora,
          platformAccountId: a.accountId,
          platformConversationId: `c-${String(i)}`,
          platformFanId: `f-${String(i)}`,
          fanDisplayName: `Fan inventé ${String(i)}`,
          message: {
            ref: { platform: 'reveal', id: `out-${String(i)}` },
            conversationRef: { platform: 'reveal', id: `c-${String(i)}` },
            direction: 'outbound',
            text: 'Un cadeau',
            media: [],
            priceMinor: 3000,
            currency: 'EUR',
            isPaid: true,
            createdAt: yesterday.toISOString(),
          },
          correlationId: 'seed',
        });
      const [row] = await test.admin.db
        .select({ fanId: schema.conversations.fanId })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, result.conversationId));
      if (row === undefined) throw new Error('conversation not ingested');
      fans.push(FanIdSchema.parse(row.fanId));
    }
    await test.admin.db
      .update(schema.fans)
      .set({ firstSeenAt: longAgo })
      .where(eq(schema.fans.creatorId, nora));
    const fan = (i: number) => {
      const id = fans[i];
      if (id === undefined) throw new Error('missing fan');
      return id;
    };

    // Twelve fans said 30 and « infirmier » (fan 12 said nothing).
    for (let i = 0; i < 12; i += 1) {
      await fact({ fanId: fan(i), key: 'Age', value: i === 0 ? 'trente ans' : '30 ans' });
      await fact({ fanId: fan(i), key: 'job', value: 'Infirmier de nuit', category: 'life' });
    }
    // One fact per fan and key: an older one of another category does not count twice.
    await fact({
      fanId: fan(1),
      key: 'age',
      value: '31',
      category: 'life',
      observedAt: longAgo,
      createdAt: longAgo,
    });
    // Never counted: inferred, a chatter's note, a commercial fact.
    await fact({ fanId: fan(2), key: 'age', value: '60', kind: 'inferred', observedAt: new Date() });
    await fact({ fanId: fan(3), key: 'age', value: '70', category: 'operator_note', observedAt: new Date() });
    await fact({ fanId: fan(3), key: 'situation', value: 'marié', category: 'commercial' });
    // Written today: counts from tomorrow only (§ 2).
    await fact({ fanId: fan(12), key: 'age', value: '50', createdAt: new Date() });
    // Superseded today: the old fact still counts.
    const old = await fact({ fanId: fan(4), key: 'location', value: 'Lyon' });
    const today = await fact({ fanId: fan(4), key: 'location', value: 'Genève', createdAt: new Date() });
    await test.admin.db
      .update(schema.fanFacts)
      .set({ supersededBy: today })
      .where(eq(schema.fanFacts.id, old));
    // Superseded before midnight: the new fact counts (46, fan 5).
    const before = await fact({
      fanId: fan(5),
      key: 'age',
      value: '30',
      createdAt: longAgo,
      observedAt: longAgo,
    });
    await test.admin.db
      .update(schema.fanFacts)
      .set({ supersededBy: await fact({ fanId: fan(5), key: 'age', value: '46', observedAt: new Date() }) })
      .where(eq(schema.fanFacts.id, before));
    // Expired before midnight: does not count.
    await fact({ fanId: fan(6), key: 'situation', value: 'célibataire' });
    await test.admin.db
      .update(schema.fanFacts)
      .set({ expiresAt: yesterday })
      .where(sql`${schema.fanFacts.fanId} = ${fan(6)} and ${schema.fanFacts.key} = 'situation'`);
    // A disputed age: the fan is in no figure drawn from facts.
    await test.admin.db
      .update(schema.fans)
      .set({ flags: { ageDisputed: { since: yesterday.toISOString(), by: 'policy' } } })
      .where(eq(schema.fans.id, fan(7)));

    noraCookie = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    inesCookie = await account('ines@example.test', { role: 'creator', creatorIds: [b.creatorId] });
    operatorCookie = await account('ope@example.test', { role: 'operator', creatorIds: [nora] });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('answers shares from declared facts active at midnight, one per fan and key', async () => {
    const response = await get(noraCookie);
    expect(response.statusCode).toBe(200);
    const insights = CreatorFanInsightsSchema.parse(response.json());
    // 13 fans: rounded to ten, never the exact count (ADR 0074 § 8).
    expect(insights.fans).toEqual({ total: 10, newLast30Days: 10, wroteLast7Days: 10 });
    // Eleven ages: 30 ten times (fans 0–4, 6, 8–11), 46 once (fan 5); fan 7 disputed, fan 12 written today.
    expect(insights.age).toEqual({
      status: 'enough',
      aboutFans: 10,
      cases: [
        { key: '25_34', share: 91 },
        { key: 'other', share: 9 },
      ],
      averageAge: 31,
    });
    expect(insights.job).toEqual({ status: 'enough', aboutFans: 10, cases: [{ key: 'health', share: 100 }] });
    // One place (Lyon, kept while its replacement is from today), one situation at most: under the threshold.
    expect(insights.place).toEqual({ status: 'too_few' });
    expect(insights.situation).toEqual({ status: 'too_few' });
    expect(insights.spending).toEqual({
      status: 'enough',
      payingShare: 46,
      averageBasketMinor: null,
      cases: [
        { key: 'none', share: 54 },
        { key: '20_100', share: 46 },
      ],
    });
    expect(insights.activity.status).toBe('enough');
  });

  it('never carries a value a fan wrote', async () => {
    const body = (await get(noraCookie)).body;
    for (const word of ['Infirmier', 'trente', 'Lyon', 'Genève', 'marié', 'Fan inventé'])
      expect(body).not.toContain(word);
  });

  it('reads her own fans only', async () => {
    const insights = CreatorFanInsightsSchema.parse((await get(inesCookie)).json());
    expect(insights.fans.total).toBeNull();
    expect(insights.age).toEqual({ status: 'too_few' });
    expect(insights.activity).toEqual({ status: 'too_few' });
  });

  it('is closed to the team', async () => {
    expect((await get(operatorCookie)).statusCode).toBe(403);
  });
});
