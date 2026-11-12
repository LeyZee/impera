import {
  AccountPayRulesIdSchema,
  ApiErrorSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportEstimateSchema,
  TeamMemberSchema,
  type CreatorId,
  type PlatformAccountId,
  type ShiftId,
  type TeamMember,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';

const codeOf = (response: LightMyRequestResponse): string => ApiErrorSchema.parse(response.json()).error.code;

describe('Commission estimée d’un rapport de fin de shift (/v1/payroll/shifts/:shiftId/estimate, reco 19)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let theoCookie: string;
  let basileCookie: string;
  let noraCookie: string;
  /** Théo's shifts on an account in euros, one in dollars, one read by the connector, one without rules. */
  let theoEur: ShiftId;
  let theoUsd: ShiftId;
  let theoDetected: ShiftId;
  let theoBare: ShiftId;
  let basileEur: ShiftId;

  const call = (url: string, cookie: string) =>
    server.inject({ method: 'GET', url: `/v1${url}`, headers: { cookie, origin: DASHBOARD_ORIGIN } });

  const estimate = async (shiftId: ShiftId, amountMinor: number, cookie: string): Promise<number | null> => {
    const response = await call(
      `/payroll/shifts/${shiftId}/estimate?amountMinor=${String(amountMinor)}`,
      cookie,
    );
    expect(response.statusCode, response.body).toBe(200);
    return ShiftReportEstimateSchema.parse(response.json()).commissionMinor;
  };

  const addMember = async (body: {
    email: string;
    displayName: string;
    teamRole: 'chatter' | 'manager';
    rateBps: number;
  }): Promise<{ member: TeamMember; cookie: string }> => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/team/members',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        email: body.email,
        displayName: body.displayName,
        teamRole: body.teamRole,
        creatorIds: [anna],
        firstName: body.displayName,
        lastName: 'Inventé',
        country: 'FR',
        timeZone: 'Europe/Paris',
        joinedOn: parisDay(-30),
        commission: { rateBps: body.rateBps },
        teamShareBps: body.teamRole === 'manager' ? 500 : null,
      },
    });
    expect(response.statusCode).toBe(201);
    const member = TeamMemberSchema.parse(response.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: member.userId,
      providerId: 'credential',
      accountId: member.userId,
      password: await context.password.hash(PASSWORD),
    });
    return { member, cookie: await signIn(server, body.email, PASSWORD) };
  };

  /** 10:00 to 12:00 in Paris `days` before today, as the planning would have written it. */
  const shiftOf = async (
    member: TeamMember,
    platformAccountId: PlatformAccountId,
    days: number,
  ): Promise<ShiftId> => {
    const id = newId(ShiftIdSchema);
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId: anna,
      platformAccountId,
      memberId: member.id,
      startsAt: parisInstant(parisDay(-days), 600),
      endsAt: parisInstant(parisDay(-days), 720),
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    return id;
  };

  const rulesFor = (
    platformAccountId: PlatformAccountId,
    rules: { currency: 'EUR' | 'USD'; vatBps: number; source: 'declared' | 'detected' },
  ) =>
    test.admin.db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId: anna,
      platformAccountId,
      fromPeriod: '2020-01-01',
      currency: rules.currency,
      vatBps: rules.vatBps,
      platformFeeBps: 2000,
      earningsSource: rules.source,
      createdBy: ownerId,
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
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER));
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    const [eur, usd, detected, bare] = [0, 1, 2, 3].map(() => newId(PlatformAccountIdSchema));
    if (eur === undefined || usd === undefined || detected === undefined || bare === undefined)
      throw new Error('ids');
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: eur, creatorId: anna, platform: 'reveal', handle: 'anna-euros' },
      { id: usd, creatorId: anna, platform: 'reveal', handle: 'anna-dollars' },
      { id: detected, creatorId: anna, platform: 'reveal', handle: 'anna-lue' },
      { id: bare, creatorId: anna, platform: 'reveal', handle: 'anna-sans-regles' },
    ]);
    await rulesFor(eur, { currency: 'EUR', vatBps: 2000, source: 'declared' });
    await rulesFor(usd, { currency: 'USD', vatBps: 0, source: 'declared' });
    await rulesFor(detected, { currency: 'EUR', vatBps: 2000, source: 'detected' });
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    const theo = await addMember({
      email: 'theo@example.test',
      displayName: 'Théo',
      teamRole: 'chatter',
      rateBps: 1000,
    });
    const basile = await addMember({
      email: 'basile@example.test',
      displayName: 'Basile',
      teamRole: 'chatter',
      rateBps: 1500,
    });
    ({ cookie: noraCookie } = await addMember({
      email: 'nora@example.test',
      displayName: 'Nora',
      teamRole: 'manager',
      rateBps: 1000,
    }));
    theoCookie = theo.cookie;
    basileCookie = basile.cookie;
    theoEur = await shiftOf(theo.member, eur, 1);
    theoUsd = await shiftOf(theo.member, usd, 2);
    theoDetected = await shiftOf(theo.member, detected, 3);
    theoBare = await shiftOf(theo.member, bare, 4);
    basileEur = await shiftOf(basile.member, eur, 1);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('says what the amount brings the member, by pay’s chain, a correction’s minus included', async () => {
    // 120 € without 20 % VAT = 100 €, less 20 % to Reveal = 80 €, at Théo's 10 % = 8 €.
    expect(await estimate(theoEur, 12_000, theoCookie)).toBe(800);
    // A correction of −12 € takes off as much as it would have brought.
    expect(await estimate(theoEur, -1_200, theoCookie)).toBe(-80);
    expect(await estimate(theoEur, 0, theoCookie)).toBe(0);
  });

  it('counts the shift’s member’s rate, whoever asks among those who may', async () => {
    // Basile is at 15 %: 80 € × 15 % = 12 €, for Nora the manager and for the owner alike.
    expect(await estimate(basileEur, 12_000, basileCookie)).toBe(1_200);
    expect(await estimate(basileEur, 12_000, noraCookie)).toBe(1_200);
    expect(await estimate(theoEur, 12_000, owner)).toBe(800);
  });

  it('says nothing it cannot know, and never guesses an exchange rate', async () => {
    expect(await estimate(theoDetected, 12_000, theoCookie)).toBeNull();
    expect(await estimate(theoBare, 12_000, theoCookie)).toBeNull();
    expect(await estimate(theoUsd, 10_000, theoCookie)).toBeNull();
    await test.admin.db.insert(schema.exchangeRates).values({
      currency: 'USD',
      day: parisDay(-2),
      rateMicros: 920_000,
      source: 'test',
      fetchedAt: new Date(),
    });
    // 100 $ at 0,92 = 92 €, no VAT, less 20 % to Reveal = 73,60 €, at 10 % = 7,36 €.
    expect(await estimate(theoUsd, 10_000, theoCookie)).toBe(736);
  });

  it('keeps a colleague’s shift and every creator out', async () => {
    const colleague = await call(`/payroll/shifts/${theoEur}/estimate?amountMinor=12000`, basileCookie);
    expect([colleague.statusCode, codeOf(colleague)]).toEqual([404, 'shift_not_found']);
    const unknown = await call(`/payroll/shifts/${newId(ShiftIdSchema)}/estimate?amountMinor=12000`, owner);
    expect([unknown.statusCode, codeOf(unknown)]).toEqual([404, 'shift_not_found']);
    expect((await call(`/payroll/shifts/${theoEur}/estimate?amountMinor=12000`, creator)).statusCode).toBe(
      403,
    );
  });

  it('refuses an amount a report could not carry', async () => {
    for (const amount of ['5000001', '12,5', 'abc', '']) {
      const response = await call(`/payroll/shifts/${theoEur}/estimate?amountMinor=${amount}`, theoCookie);
      expect(response.statusCode, amount).toBe(400);
    }
    expect((await call(`/payroll/shifts/${theoEur}/estimate`, theoCookie)).statusCode).toBe(400);
  });
});
