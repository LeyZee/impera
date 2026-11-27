import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  FanListPageSchema,
  MessageIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  TeamMemberIdSchema,
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
 * ADR 0124 through the real app: every fan of a creator, for the owner and an active manager of her list only, with
 * what each paid in the register (sales less refunds), his latest conversation, his states, the filters, the search
 * without accents, the orders and the pages. Read only. Everything is invented (ADR 0010).
 */
describe('GET /v1/fans, every fan of a creator for the agency (ADR 0124)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let otherCreatorId: CreatorId;
  let accountId: PlatformAccountId;
  let otherAccountId: PlatformAccountId;
  type Who = 'owner' | 'manager' | 'otherManager' | 'chatter' | 'creator';
  const cookies = new Map<Who, string>();
  const fanIds = new Map<string, FanId>();
  const now = Date.now();

  const get = (who: Who, query: string) =>
    server.inject({
      method: 'GET',
      url: `/v1/fans?${query}`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
    });
  const list = async (query: string, who: Who = 'owner') => {
    const answer = await get(who, `creatorId=${creatorId}&${query}`);
    expect(answer.statusCode, answer.body).toBe(200);
    return FanListPageSchema.parse(answer.json());
  };
  const names = async (query: string) => (await list(query)).items.map((item) => item.displayName);

  async function person(key: Exclude<Who, 'owner'>, role: 'operator' | 'creator', creators: CreatorId[]) {
    const email = `${key}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: key, password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role, creatorIds: creators })
      .where(eq(schema.user.id, userId));
    cookies.set(key, await signIn(server, email, PASSWORD));
    return userId;
  }

  async function member(userId: string, teamRole: 'manager' | 'chatter') {
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `Membre ${teamRole}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
  }

  async function fan(
    platformFanId: string,
    displayName: string,
    patch: { flags?: object; account?: PlatformAccountId; creator?: CreatorId } = {},
  ) {
    const id = newId(FanIdSchema);
    await test.admin.db.insert(schema.fans).values({
      id,
      creatorId: patch.creator ?? creatorId,
      platformAccountId: patch.account ?? accountId,
      platformFanId,
      displayName,
      flags: patch.flags ?? {},
      firstSeenAt: new Date(now - 60 * DAY),
    });
    fanIds.set(displayName, id);
    return id;
  }

  async function conversation(
    fanId: FanId,
    patch: {
      inbound?: number;
      outbound?: number;
      mode?: string;
      state?: string;
      care?: boolean;
      routedTo?: string;
    },
  ) {
    const id = newId(ConversationIdSchema);
    await test.admin.db.insert(schema.conversations).values({
      id,
      creatorId,
      platformAccountId: accountId,
      fanId,
      platformConversationId: `conv_${fanId}`,
      mode: patch.mode ?? 'copilot',
      state: patch.state ?? 'idle',
      lastInboundAt: patch.inbound === undefined ? null : new Date(now - patch.inbound * DAY),
      lastOutboundAt: patch.outbound === undefined ? null : new Date(now - patch.outbound * DAY),
      careSince: patch.care === true ? new Date(now - DAY) : null,
      routedToUserId: patch.routedTo ?? null,
    });
    return id;
  }

  let position = 0;
  async function sale(
    platformFanId: string,
    saleId: string,
    daysAgo: number,
    gross: number,
    patch: { event?: 'sale' | 'refund'; currency?: 'EUR' | 'USD' } = {},
  ) {
    position += 1;
    await test.admin.db.insert(schema.platformSales).values({
      id: newId(SalesLineIdSchema),
      creatorId,
      platformAccountId: accountId,
      platform: 'reveal',
      platformSaleId: saleId,
      event: patch.event ?? 'sale',
      saleType: 'ppv',
      status: patch.event === 'refund' ? 'refunded' : 'paid',
      occurredAt: new Date(now - daysAgo * DAY),
      platformModelId: 'model_test_01',
      platformChatterId: null,
      platformFanId,
      currency: patch.currency ?? 'EUR',
      grossInclVatMinor: gross,
      grossExclVatMinor: Math.round((gross * 5) / 6),
      netMinor: Math.round((gross * 2) / 3),
      agencyMinor: Math.round(gross / 4),
      creatorMinor: Math.round((gross * 2) / 3) - Math.round(gross / 4),
      position: String(position).padStart(6, '0'),
      inputsHash: `hash-${saleId}-${patch.event ?? 'sale'}`,
    });
  }

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
    otherCreatorId = newId(CreatorIdSchema);
    accountId = newId(PlatformAccountIdSchema);
    otherAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: creatorId, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: otherCreatorId, nameKey: 'lea', displayName: 'Léa', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: accountId, creatorId, platform: 'reveal', handle: 'creatrice_test' },
      { id: otherAccountId, creatorId: otherCreatorId, platform: 'reveal', handle: 'creatrice_autre' },
    ]);

    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    await member(await person('manager', 'operator', [creatorId]), 'manager');
    await member(await person('otherManager', 'operator', [otherCreatorId]), 'manager');
    const chatter = await person('chatter', 'operator', [creatorId]);
    await member(chatter, 'chatter');
    await person('creator', 'creator', [creatorId]);

    // Élodie: a big payer this month, the agent holds her conversation, waiting for our answer.
    await conversation(await fan('fan_elodie', 'Élodie'), { inbound: 1, outbound: 2, mode: 'auto' });
    await sale('fan_elodie', 'sale_e1', 3, 5000);
    await sale('fan_elodie', 'sale_e2', 40, 2000);
    // Bruno: paid long ago, then nothing (lapsed); a refund taken off; age disputed and nothing to write to him.
    await conversation(
      await fan('fan_bruno', 'Bruno', {
        flags: {
          ageDisputed: { since: new Date(now - DAY).toISOString(), by: 'policy' },
          doNotContact: true,
        },
      }),
      { inbound: 30, outbound: 29, state: 'human', routedTo: chatter },
    );
    await sale('fan_bruno', 'sale_b1', 50, 3000);
    await sale('fan_bruno', 'sale_b2', 45, 1000);
    await sale('fan_bruno', 'sale_b2', 44, 1000, { event: 'refund' });
    // Chloé: paid in dollars this week, in care.
    await conversation(await fan('fan_chloe', 'Chloé'), { inbound: 3, outbound: 3, care: true });
    await sale('fan_chloe', 'sale_c1', 2, 1500, { currency: 'USD' });
    // Dan: never paid, never answered by us. His message was written 5 days ago, read in just now by a catch-up of the
    // connector: his last message is the platform's time, never the time it was read in (PRO1-05).
    const danConversation = await conversation(await fan('fan_dan', 'Dan'), { inbound: 0.01 });
    await test.admin.db.insert(schema.messages).values({
      id: newId(MessageIdSchema),
      creatorId,
      platformAccountId: accountId,
      conversationId: danConversation,
      platformMessageId: 'msg_dan_1',
      direction: 'inbound',
      author: 'fan',
      text: 'Un message inventé',
      platformCreatedAt: new Date(now - 5 * DAY),
    });
    // Ève: known, never wrote, no conversation.
    await fan('fan_eve', 'Ève');
    // A fan of another creator: never in her list.
    await fan('fan_autre', 'Autre', { account: otherAccountId, creator: otherCreatorId });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('lists every fan she has, last message first, with what each paid, who holds him and his states', async () => {
    const page = await list('');
    expect(page.items.map((item) => item.displayName)).toEqual(['Élodie', 'Chloé', 'Dan', 'Bruno', 'Ève']);
    expect(page.total).toBe(5);
    expect(page.nextCursor).toBeNull();
    expect(page.sharedFansKnown).toBe(false);
    const [elodie, chloe, dan, bruno, eve] = page.items;
    expect(elodie).toMatchObject({
      paidPeriod: { eurMinor: 5000, usdMinor: 0 },
      paidEver: { eurMinor: 7000, usdMinor: 0 },
      holder: 'agent',
      unanswered: true,
      states: [],
    });
    expect(chloe).toMatchObject({
      paidEver: { eurMinor: 0, usdMinor: 1500 },
      holder: 'copilot',
      states: ['care'],
    });
    expect(dan).toMatchObject({ paidEver: { eurMinor: 0, usdMinor: 0 }, lastPaidAt: null, unanswered: true });
    expect(dan?.lastMessageAt).toBe(new Date(now - 5 * DAY).toISOString());
    // His refund taken off; a human holds him, named.
    expect(bruno).toMatchObject({
      paidEver: { eurMinor: 3000, usdMinor: 0 },
      holder: 'human',
      holderName: 'chatter',
      states: ['age_disputed', 'do_not_contact'],
    });
    expect(eve).toMatchObject({ holder: 'none', conversationId: null, lastMessageAt: null });
    // Never a message, never his card: his pseudonym and figures only.
    expect(JSON.stringify(page)).not.toMatch(/fan_elodie|platformFanId|text/u);
  });

  it('keeps each list of ADR 0092 § 3 and 0124 § 2 as a filter', async () => {
    expect(await names('filter=big_payers&period=week')).toEqual(['Élodie', 'Chloé']);
    expect(await names('filter=payers&sort=paid')).toEqual(['Élodie', 'Bruno', 'Chloé']);
    expect(await names('filter=lapsed')).toEqual(['Bruno']);
    expect(await names('filter=lapsed&lapsedDays=60')).toEqual([]);
    expect(await names('filter=never_paid')).toEqual(['Dan', 'Ève']);
    expect(await names('filter=unanswered')).toEqual(['Élodie', 'Dan']);
    expect((await list('filter=lapsed')).total).toBe(1);
  });

  it('searches his pseudonym without minding accents or case', async () => {
    expect(await names('q=elo')).toEqual(['Élodie']);
    expect(await names('q=ÉVE')).toEqual(['Ève']);
    expect(await names('q=chlo')).toEqual(['Chloé']);
    expect(await names('q=zzz')).toEqual([]);
  });

  it('pages by key, without losing or repeating a fan', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof list>> = await list(
        `sort=last_payment&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      );
      expect(page.total).toBe(5);
      seen.push(...page.items.map((item) => item.displayName));
      cursor = page.nextCursor;
    } while (cursor !== null);
    // The latest purchase first; his refunded purchase is no purchase; who never paid last, in a fixed order.
    expect(seen.slice(0, 3)).toEqual(['Chloé', 'Élodie', 'Bruno']);
    expect(seen.slice(3).sort()).toEqual(['Dan', 'Ève']);
    expect((await get('owner', `creatorId=${creatorId}&cursor=nope`)).statusCode).toBe(400);
  });

  it('opens to an active manager of her list, never to a manager of others, a chatter or the creator', async () => {
    expect((await list('', 'manager')).total).toBe(5);
    expect((await get('otherManager', `creatorId=${creatorId}`)).statusCode).toBe(403);
    expect((await get('chatter', `creatorId=${creatorId}`)).statusCode).toBe(403);
    expect((await get('creator', `creatorId=${creatorId}`)).statusCode).toBe(403);
    // Her own list for the other manager: one fan, never hers.
    const other = await get('otherManager', `creatorId=${otherCreatorId}`);
    expect(FanListPageSchema.parse(other.json()).items.map((item) => item.displayName)).toEqual(['Autre']);
  });
});
