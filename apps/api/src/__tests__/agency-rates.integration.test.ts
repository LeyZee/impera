import {
  ApiErrorSchema,
  CreatorAgencyRateIdSchema,
  CreatorAgencyRateListSchema,
  CreatorAgencyRateSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  TeamMemberSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { lockWaits } from './support/lock-waits';
import { parisDay } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and percentages only (ADR 0010): never the agency's own. */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;
const detailsOf = (response: LightMyRequestResponse) => ApiErrorSchema.parse(response.json()).error.details;

describe('Créatrices › Pourcentage de l’agence (/v1/creators/:creatorId/agency-rates, CR-04)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let creator: string;
  let manager: string;
  let anna: CreatorId;
  let ines: CreatorId;

  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const rateBody = (fromDay: string, agencyBps = 3500) => ({
    id: newId(CreatorAgencyRateIdSchema),
    fromDay,
    agencyBps,
  });
  const add = (creatorId: CreatorId, body: object, cookie = owner) =>
    call('POST', `/creators/${creatorId}/agency-rates`, cookie, body);
  const list = async (creatorId: CreatorId) => {
    const response = await call('GET', `/creators/${creatorId}/agency-rates`, owner);
    expect(response.statusCode, response.body).toBe(200);
    return CreatorAgencyRateListSchema.parse(response.json());
  };

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
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER));
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    ines = (await app.modules.persona.creators.create({ displayName: 'Inès' })).id;
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    const response = await call('POST', '/team/members', owner, {
      email: 'nora@example.test',
      displayName: 'Nora',
      firstName: 'Nora',
      lastName: 'Inventé',
      teamRole: 'manager',
      creatorIds: [anna, ines],
      country: 'FR',
      timeZone: 'Europe/Paris',
      joinedOn: parisDay(-30),
      commission: { rateBps: 1000 },
      teamShareBps: 500,
    });
    expect(response.statusCode, response.body).toBe(201);
    const member = TeamMemberSchema.parse(response.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: member.userId,
      providerId: 'credential',
      accountId: member.userId,
      password: await context.password.hash(PASSWORD),
    });
    manager = await signIn(server, 'nora@example.test', PASSWORD);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('says « à régler » while she has none: no value is made up', async () => {
    const { observed, ...read } = await list(anna);
    expect(read).toEqual({ today: parisDay(0), current: null, rates: [] });
    expect(observed.linked).toBe(false);
    expect(observed.last30Days).toEqual({ from: parisDay(-29), to: parisDay(0), shares: [] });
    expect(observed.fortnights.map((fortnight) => fortnight.shares)).toEqual([[], [], []]);
  });

  it('starts her first percentage today, once, and answers a retry with the same one', async () => {
    const past = await add(anna, rateBody(parisDay(-1)));
    expect([past.statusCode, codeOf(past)]).toEqual([400, 'agency_rate_day_invalid']);
    const body = rateBody(parisDay(0));
    const response = await add(anna, body);
    expect(response.statusCode, response.body).toBe(201);
    const rate = CreatorAgencyRateSchema.parse(response.json());
    expect(rate).toMatchObject({ ...body, creatorId: anna });
    const retry = await add(anna, body);
    expect([retry.statusCode, CreatorAgencyRateSchema.parse(retry.json())]).toEqual([200, rate]);
    const other = await add(anna, { ...body, agencyBps: 3000 });
    expect([other.statusCode, codeOf(other)]).toEqual([409, 'agency_rate_conflict']);
    const sameDay = await add(anna, rateBody(parisDay(0), 3000));
    expect([sameDay.statusCode, codeOf(sameDay), detailsOf(sameDay)]).toEqual([
      409,
      'agency_rate_day_conflict',
      { creatorAgencyRateId: rate.id },
    ]);
    const read = await list(anna);
    expect(read.current?.id).toBe(rate.id);
    expect(read.rates.map((one) => one.id)).toEqual([rate.id]);
    const [entry] = await test.admin.db
      .select({ entityId: schema.auditLog.entityId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'creator_agency_rate.create'));
    expect(entry).toEqual({
      entityId: rate.id,
      details: { creatorId: anna, fromDay: parisDay(0), agencyBps: 3500 },
    });
  });

  it('starts a later one tomorrow at the earliest, never backwards; the one in force stays until its day', async () => {
    const today = await add(anna, rateBody(parisDay(0), 3000));
    expect([today.statusCode, codeOf(today)]).toEqual([409, 'agency_rate_day_conflict']);
    const yesterday = await add(anna, rateBody(parisDay(-1), 3000));
    expect([yesterday.statusCode, codeOf(yesterday)]).toEqual([400, 'agency_rate_day_invalid']);
    const next = await add(anna, rateBody(parisDay(5), 3000));
    expect(next.statusCode, next.body).toBe(201);
    const read = await list(anna);
    expect(read.rates.map((one) => [one.fromDay, one.agencyBps])).toEqual([
      [parisDay(5), 3000],
      [parisDay(0), 3500],
    ]);
    expect(read.current?.agencyBps).toBe(3500);
  });

  it('reads whether it is her first under her lock: two sent at once never both pass as the first', async () => {
    const cleo = (await app.modules.persona.creators.create({ displayName: 'Cléo' })).id;
    // Another percentage of hers, for tomorrow, written while this one waits: the key the store locks on.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const meanwhile = test.admin.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`scheduling.agency_rate:${cleo}`}, 0))`,
      );
      locked();
      await held;
      await tx.insert(schema.creatorAgencyRates).values({
        id: newId(CreatorAgencyRateIdSchema),
        creatorId: cleo,
        fromDay: parisDay(1),
        agencyBps: 3000,
        createdBy: ownerId,
      });
    });
    await ready;
    const sending = add(cleo, rateBody(parisDay(0)));
    for (let tries = 0; (await lockWaits(test.admin.db)) < 1; tries += 1) {
      if (tries > 250) throw new Error('nobody waited for the lock');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    release();
    await meanwhile;
    const sent = await sending;
    expect([sent.statusCode, codeOf(sent)]).toEqual([400, 'agency_rate_day_invalid']);
    expect((await list(cleo)).rates.map((one) => one.fromDay)).toEqual([parisDay(1)]);
  });

  it('is the owner’s alone: neither a manager nor her own account reads or adds it', async () => {
    for (const cookie of [manager, creator]) {
      const read = await call('GET', `/creators/${anna}/agency-rates`, cookie);
      expect(read.statusCode).toBe(403);
      const added = await add(anna, rateBody(parisDay(9)), cookie);
      expect(added.statusCode).toBe(403);
    }
    expect((await list(anna)).rates).toHaveLength(2);
  });

  it('keeps each creator’s own, and knows no creator that does not exist', async () => {
    expect((await list(ines)).rates).toEqual([]);
    const unknown = newId(CreatorIdSchema);
    const read = await call('GET', `/creators/${unknown}/agency-rates`, owner);
    expect([read.statusCode, codeOf(read)]).toEqual([404, 'creator_not_found']);
    const added = await add(unknown, rateBody(parisDay(0)));
    expect([added.statusCode, codeOf(added)]).toEqual([404, 'creator_not_found']);
    const invalid = await add(ines, { ...rateBody(parisDay(0)), agencyBps: 10_001 });
    expect(invalid.statusCode).toBe(400);
    const missing = await add(ines, { id: newId(CreatorAgencyRateIdSchema), fromDay: parisDay(0) });
    expect(missing.statusCode).toBe(400);
  });

  it('shows the agency’s share as Reveal reads it, without any percentage, nothing computed again (ADR 0054 § 4)', async () => {
    const account = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: ines, platform: 'reveal', handle: 'ines_test' });
    // Two invented sales a minute ago: 3,00 € and 4,00 € for the agency of 8,00 € and 10,00 € net, 38,89 %.
    const sale = (platformSaleId: string, netMinor: number, agencyMinor: number) => ({
      id: newId(SalesLineIdSchema),
      creatorId: ines,
      platformAccountId: account,
      platform: 'reveal' as const,
      platformSaleId,
      event: 'sale' as const,
      saleType: 'ppv' as const,
      status: 'paid' as const,
      occurredAt: new Date(Date.now() - 60_000),
      platformModelId: 'model_test_01',
      platformChatterId: null,
      platformFanId: 'fan_test_01',
      currency: 'EUR' as const,
      grossInclVatMinor: netMinor * 2,
      grossExclVatMinor: netMinor * 2,
      netMinor,
      agencyMinor,
      creatorMinor: netMinor - agencyMinor,
      position: platformSaleId,
      inputsHash: `hash-${platformSaleId}`,
    });
    await test.admin.db
      .insert(schema.platformSales)
      .values([sale('sale_rate_01', 800, 300), sale('sale_rate_02', 1000, 400)]);
    await test.admin.db.insert(schema.salesFeedModels).values({
      platform: 'reveal',
      platformModelId: 'model_test_ines',
      platformAccountId: account,
      creatorId: ines,
    });
    const { observed, current, rates } = await list(ines);
    expect([current, rates, observed.linked]).toEqual([null, [], true]);
    const share = {
      platform: 'reveal',
      platformAccountId: account,
      currency: 'EUR',
      netMinor: 1800,
      agencyMinor: 700,
      agencyBps: 3889,
    };
    expect(observed.last30Days.shares).toEqual([share]);
    expect(observed.fortnights[0]?.shares).toEqual([share]);
    expect(observed.fortnights[0]?.to).toBe(parisDay(0));
    // Never a fan, a chatter nor a sale: sums and a ratio.
    expect(JSON.stringify(observed)).not.toMatch(/fan|chatter|sale_rate/iu);
    expect(
      await test.admin.db
        .select()
        .from(schema.creatorAgencyRates)
        .where(eq(schema.creatorAgencyRates.creatorId, ines)),
    ).toEqual([]);
  });
});
