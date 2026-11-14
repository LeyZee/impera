import {
  CreatorIdSchema,
  DomainError,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type TeamMemberId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';

import { testConfig } from './support/config';

const PASSWORD = 'correct horse battery';
const RANGE = { from: '2026-10-01', to: '2026-10-31' };

/**
 * The connectors' reads for the MCP (ADR 0026 § 1, ADR 0105 § 4), through the real module on the app role: the owner,
 * and an active manager for the creators of his list, read the sales, the daily statistics and the imported team;
 * nobody else does, and no read gives the agency's nor the creator's share. Everything is invented (ADR 0010).
 */
describe('connectors reads for another module (OPS-14)', () => {
  let test: TestDb;
  let app: App;
  let creatorId: CreatorId;
  let otherCreatorId: CreatorId;
  let accountId: PlatformAccountId;
  let theo: TeamMemberId;
  const users = new Map<'owner' | 'manager' | 'outsider' | 'chatter' | 'creator', string>();

  const reads = () => app.modules.connectors.reads;
  const codeOf = async (promise: Promise<unknown>): Promise<string | null> =>
    promise.then(
      () => null,
      (error: unknown) => (error instanceof DomainError ? error.code : 'not a domain error'),
    );
  const user = (key: Parameters<typeof users.get>[0]): string => {
    const id = users.get(key);
    if (id === undefined) throw new Error(`no ${key}`);
    return id;
  };

  async function person(
    key: 'manager' | 'outsider' | 'chatter' | 'creator',
    role: 'operator' | 'creator',
    creators: readonly CreatorId[],
  ): Promise<string> {
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: `${key}@example.test`,
      name: key,
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role, creatorIds: [...creators] })
      .where(eq(schema.user.id, userId));
    users.set(key, userId);
    return userId;
  }

  async function member(userId: string, teamRole: 'manager' | 'chatter', displayName: string) {
    const id = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id,
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return id;
  }

  let position = 0;
  async function line(
    saleId: string,
    chatter: string | null,
    at: string,
    event: 'sale' | 'refund',
    gross: number,
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
      occurredAt: new Date(at),
      platformModelId: 'model_test_01',
      platformChatterId: chatter,
      platformFanId: 'fan_test_01',
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

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));

    creatorId = newId(CreatorIdSchema);
    otherCreatorId = newId(CreatorIdSchema);
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: creatorId, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: otherCreatorId, nameKey: 'lea', displayName: 'Léa', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: 'creatrice_test' });
    await test.admin.db.insert(schema.salesFeedModels).values({
      platform: 'reveal',
      platformModelId: 'model_test_01',
      platformAccountId: accountId,
      creatorId,
    });

    const { userId: ownerId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    users.set('owner', ownerId);
    await member(await person('manager', 'operator', [creatorId]), 'manager', 'Maya');
    // An active manager whose list does not hold Nora: he reads none of her figures.
    await member(await person('outsider', 'operator', [otherCreatorId]), 'manager', 'Malo');
    theo = await member(await person('chatter', 'operator', [creatorId]), 'chatter', 'Théo');
    await person('creator', 'creator', [creatorId]);
    await test.admin.db.insert(schema.salesFeedChatters).values([
      { platform: 'reveal', platformChatterId: 'chatter_theo', kind: 'member', memberId: theo },
      { platform: 'reveal', platformChatterId: 'bot_test_01', kind: 'agent' },
    ]);

    await line('sale_theo', 'chatter_theo', '2026-10-05T12:00:00Z', 'sale', 1200);
    await line('sale_theo_2', 'chatter_theo', '2026-10-06T12:00:00Z', 'sale', 600);
    await line('sale_theo_2', 'chatter_theo', '2026-10-06T13:00:00Z', 'refund', 600);
    await line('sale_agent', 'bot_test_01', '2026-10-07T12:00:00Z', 'sale', 3000);
    // Outside the period: never in the read.
    await line('sale_old', 'chatter_theo', '2026-09-10T12:00:00Z', 'sale', 2400);

    await test.admin.db.insert(schema.platformDailyStats).values({
      platform: 'reveal',
      platformAccountId: accountId,
      creatorId,
      day: '2026-10-05',
      newSubscribers: 3,
      unsubscribes: null,
      activeSubscribers: 40,
      renewals: 2,
      ppvSent: null,
      ppvPurchased: 1,
      messagesSent: 12,
      messagesReceived: 9,
      readAt: new Date('2026-10-06T04:00:00Z'),
    });
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('gives the owner the period’s sales as the platform says them, without either share', async () => {
    const [nora] = await reads().sales(user('owner'), [creatorId], RANGE);
    expect(nora?.creatorId).toBe(creatorId);
    expect(
      nora?.rows.map((row) => [row.day, row.seller.kind, row.sales, row.refunds, row.grossInclVatMinor]),
    ).toEqual(
      expect.arrayContaining([
        ['2026-10-05', 'member', 1, 0, 1200],
        ['2026-10-06', 'member', 1, 1, 0],
        ['2026-10-07', 'agent', 1, 0, 3000],
      ]),
    );
    expect(nora?.rows).toHaveLength(3);
    expect(nora?.readings.map((reading) => reading.platform)).toEqual(['reveal']);
    // No rate can be read back: neither share is in the answer, under any name.
    const text = JSON.stringify(nora);
    expect(text).not.toMatch(/agency|creatorMinor/iu);
    expect(text).not.toMatch(/fan_test_01/u);
  });

  it('sums the period by seller with the member’s name, and never the shares', async () => {
    const [nora] = await reads().salesByChatter(user('owner'), [creatorId], RANGE);
    expect(
      nora?.rows.map((row) => [row.seller.kind, row.sellerDisplayName, row.sales, row.refunds, row.netMinor]),
    ).toEqual([
      ['agent', null, 1, 0, 2000],
      ['member', 'Théo', 2, 1, 800],
    ]);
    expect(JSON.stringify(nora)).not.toMatch(/agency|creatorMinor/iu);
  });

  it('lets an active manager read the creators of his list, and refuses every other reader', async () => {
    expect(await reads().sales(user('manager'), [creatorId], RANGE)).toHaveLength(1);
    expect(await reads().dailyStats(user('manager'), [creatorId], RANGE)).toHaveLength(1);
    for (const who of ['outsider', 'chatter', 'creator'] as const) {
      expect(await codeOf(reads().sales(user(who), [creatorId], RANGE))).toBe('connector_reads_forbidden');
      expect(await codeOf(reads().salesByChatter(user(who), [creatorId], RANGE))).toBe(
        'connector_reads_forbidden',
      );
      expect(await codeOf(reads().dailyStats(user(who), [creatorId], RANGE))).toBe(
        'connector_reads_forbidden',
      );
    }
    // One creator out of his list refuses the whole call: nothing of the others is given.
    expect(await codeOf(reads().sales(user('manager'), [creatorId, otherCreatorId], RANGE))).toBe(
      'connector_reads_forbidden',
    );
  });

  it('gives the daily statistics as counters, with their reading time', async () => {
    const [nora] = await reads().dailyStats(user('owner'), [creatorId], RANGE);
    expect(nora?.days).toEqual([
      {
        platform: 'reveal',
        platformAccountId: accountId,
        day: '2026-10-05',
        newSubscribers: 3,
        unsubscribes: null,
        activeSubscribers: 40,
        renewals: 2,
        ppvSent: null,
        ppvPurchased: 1,
        messagesSent: 12,
        messagesReceived: 9,
        readAt: '2026-10-06T04:00:00.000Z',
      },
    ]);
  });

  it('refuses a period out of order or longer than a quarter, before reading anything', async () => {
    expect(
      await codeOf(reads().sales(user('owner'), [creatorId], { from: '2026-10-31', to: '2026-10-01' })),
    ).toBe('connector_reads_range_unprocessable');
    expect(
      await codeOf(reads().dailyStats(user('owner'), [creatorId], { from: '2026-01-01', to: '2026-10-31' })),
    ).toBe('connector_reads_range_unprocessable');
  });

  it('gives the imported team as the base keeps it, to the owner and an active manager only, without asking the platform', async () => {
    const readings = async () =>
      (await test.admin.db.execute(sql`select count(*)::int as n from sales_feed_team_readings`)).rows;
    const before = await readings();
    const team = await reads().teamImport(user('owner'), 'reveal');
    expect(team.accounts).toEqual([
      { platformChatterId: 'bot_test_01', link: { kind: 'agent' }, removed: false },
      {
        platformChatterId: 'chatter_theo',
        link: { kind: 'member', memberId: theo, memberDisplayName: 'Théo' },
        removed: false,
      },
    ]);
    expect((await reads().teamImport(user('manager'), 'reveal')).accounts).toHaveLength(2);
    for (const who of ['chatter', 'creator'] as const) {
      expect(await codeOf(reads().teamImport(user(who), 'reveal'))).toBe('sales_feed_team_forbidden');
    }
    // A read writes nothing: no reading of the platform's list is recorded.
    expect(await readings()).toEqual(before);
  });
});
