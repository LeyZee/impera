import {
  ApiErrorSchema,
  CalendarSchema,
  DashboardSchema,
  ConversationIdSchema,
  FanIdSchema,
  KillSwitchIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberSchema,
  type CreatorId,
  type PlatformAccountId,
  type TeamMember,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { iso, parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };
const PASSWORD = 'staple battery horse';
const DAY_MINUTES = 24 * 60;

describe('Équipe › Calendrier (GET /v1/scheduling/calendar, CR-12)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let creator: string;
  let anna: CreatorId;
  let ines: CreatorId;
  let annaAccount: PlatformAccountId;
  let inesAccount: PlatformAccountId;
  let theo: TeamMember;
  let basile: TeamMember;
  let theoCookie: string;
  let basileCookie: string;
  let noraCookie: string;
  // Tomorrow in Paris, from midnight to midnight: four créneaux of 6 h on each account.
  const day = parisDay(1);
  const from = parisInstant(day, 0);
  const to = parisInstant(parisDay(2), 0);

  const call = (url: string, cookie: string) =>
    server.inject({ method: 'GET', url: `/v1${url}`, headers: { cookie, origin: DASHBOARD_ORIGIN } });

  const calendar = async (cookie: string, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({ from: iso(from), to: iso(to), ...extra });
    const response = await call(`/scheduling/calendar?${query.toString()}`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    return CalendarSchema.parse(response.json());
  };

  const addMember = async (body: {
    email: string;
    displayName: string;
    teamRole: 'chatter' | 'manager';
    creatorIds: CreatorId[];
  }): Promise<{ member: TeamMember; cookie: string }> => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/team/members',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        ...body,
        firstName: body.displayName,
        lastName: 'Inventé',
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: parisDay(-30),
        commission: { rateBps: 1000 },
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

  const addShift = async (
    memberId: string,
    creatorId: string,
    accountId: string,
    start: number,
    end: number,
  ) => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/scheduling/shifts',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        memberId,
        creatorId,
        platformAccountId: accountId,
        startsAt: iso(parisInstant(day, start)),
        endsAt: iso(parisInstant(day, end)),
      },
    });
    expect(response.statusCode).toBe(201);
  };

  /** The calendar's agent says the dashboard's mode (supervision), on the same data: the two never diverge (Bilan). */
  const expectSameModeAsDashboard = async (read: { agent: { creatorId: string; mode: string }[] }) => {
    for (const agent of read.agent) {
      const response = await call(`/dashboard?creatorId=${agent.creatorId}`, owner);
      expect(response.statusCode, response.body).toBe(200);
      expect(DashboardSchema.parse(response.json()).mode).toBe(agent.mode);
    }
  };

  const setStatus = (member: TeamMember, status: 'active' | 'sick' | 'suspended') =>
    test.admin.db.update(schema.teamMembers).set({ status }).where(eq(schema.teamMembers.id, member.id));

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    ines = (await app.modules.persona.creators.create({ displayName: 'Inès' })).id;
    annaAccount = newId(PlatformAccountIdSchema);
    inesAccount = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: annaAccount, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
      { id: inesAccount, creatorId: ines, platform: 'reveal', handle: 'ines-inventee' },
    ]);
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
    ({ member: theo, cookie: theoCookie } = await addMember({
      email: 'theo@example.test',
      displayName: 'Théo',
      teamRole: 'chatter',
      creatorIds: [anna],
    }));
    ({ member: basile, cookie: basileCookie } = await addMember({
      email: 'basile@example.test',
      displayName: 'Basile',
      teamRole: 'chatter',
      creatorIds: [anna, ines],
    }));
    ({ cookie: noraCookie } = await addMember({
      email: 'nora@example.test',
      displayName: 'Nora',
      teamRole: 'manager',
      creatorIds: [anna, ines],
    }));
    // Théo on Anna 10:00–14:00 (touches 6–12 and 12–18); Basile on Inès 20:00–23:00 (touches 18–24).
    await addShift(theo.id, anna, annaAccount, 600, 840);
    await addShift(basile.id, ines, inesAccount, 1200, 1380);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the owner and an active manager every shift, the agent, and what to fill', async () => {
    for (const cookie of [owner, noraCookie]) {
      const read = await calendar(cookie);
      expect(read.view).toBe('agency');
      expect(read.creators.map((one) => one.name).toSorted()).toEqual(['Anna', 'Inès']);
      expect(read.shifts.map((shift) => shift.memberId).toSorted()).toEqual([theo.id, basile.id].toSorted());
      expect(read.members.map((member) => member.displayName).toSorted()).toEqual(['Basile', 'Théo']);
      expect(read.agent.map((agent) => [agent.creatorId, agent.mode, agent.reply.mode]).toSorted()).toEqual(
        [
          [anna, 'copilot', 'always'],
          [ines, 'copilot', 'always'],
        ].toSorted(),
      );
      // Always open: he answers the whole window, read on her clock by the server.
      expect(read.agent.map((agent) => agent.answers)).toEqual([
        [{ startsAt: from.toISOString(), endsAt: to.toISOString() }],
        [{ startsAt: from.toISOString(), endsAt: to.toISOString() }],
      ]);
      const agency = read.agency;
      expect(agency).not.toBeNull();
      if (agency === null) return;
      expect(agency.accounts.map((account) => account.handle).toSorted()).toEqual([
        'anna-invente',
        'ines-inventee',
      ]);
      // In Copilote the agent holds nothing alone. A créneau a shift holds in part keeps its open stretches to fill
      // (EQ-01): all four on each account, Théo's 10–14 leaving 6–10 and 14–18 open.
      expect(agency.aiAlone).toEqual([]);
      const free = (account: string) => agency.toFill.filter((slot) => slot.platformAccountId === account);
      const stretch = (start: number, end: number) => ({
        startsAt: parisInstant(day, start).toISOString(),
        endsAt: parisInstant(day, end).toISOString(),
      });
      expect(free(annaAccount).map((slot) => slot.open)).toEqual([
        [stretch(0, 360)],
        [stretch(360, 600)],
        [stretch(840, 1080)],
        [stretch(1080, 1440)],
      ]);
      expect(free(inesAccount).at(-1)?.open).toEqual([stretch(1080, 1200), stretch(1380, 1440)]);
      expect(free(inesAccount)).toHaveLength(4);
      expect(agency.workload).toEqual([
        { memberId: theo.id, minutes: 240 },
        { memberId: basile.id, minutes: 180 },
      ]);
      for (const coverage of agency.coverage) {
        expect(coverage.withAgent + coverage.chatterAlone + coverage.agentAlone + coverage.nobody).toBe(
          DAY_MINUTES,
        );
        expect(coverage.agentAlone).toBe(0);
      }
    }
  });

  it('gives an active chatter the whole team and the agent, in reading, without the agency’s figures', async () => {
    const read = await calendar(theoCookie);
    expect(read.view).toBe('team');
    // Basile's shift on Inès, a creator Théo does not work on, is part of the team's week.
    expect(read.shifts).toHaveLength(2);
    expect(read.members.map((member) => member.displayName).toSorted()).toEqual(['Basile', 'Théo']);
    expect(read.agent).toHaveLength(2);
    expect(read.agency).toBeNull();
    expect(Object.keys(read.shifts[0] ?? {}).toSorted()).toEqual([
      'creatorId',
      'endsAt',
      'memberId',
      'startsAt',
    ]);
  });

  it('narrows a member who is not active to their own shifts, with no agent and no other creator', async () => {
    await setStatus(basile, 'sick');
    try {
      const read = await calendar(basileCookie);
      expect(read.view).toBe('own');
      expect(read.shifts.map((shift) => shift.memberId)).toEqual([basile.id]);
      expect(read.members.map((member) => member.displayName)).toEqual(['Basile']);
      expect(read.creators.map((one) => one.name)).toEqual(['Inès']);
      expect(read.agent).toEqual([]);
      expect(read.agency).toBeNull();
    } finally {
      await setStatus(basile, 'active');
    }
  });

  it('counts the créneaux of a member who is not at work as to fill: his shift holds nothing (recette EQP-03)', async () => {
    await setStatus(theo, 'suspended');
    try {
      const read = await calendar(owner);
      // His shift stays in the week, but Anna's day is open from end to end.
      expect(read.shifts.some((shift) => shift.memberId === theo.id)).toBe(true);
      const stretch = (start: number, end: number) => [
        { startsAt: parisInstant(day, start).toISOString(), endsAt: parisInstant(day, end).toISOString() },
      ];
      expect(
        read.agency?.toFill.filter((slot) => slot.platformAccountId === annaAccount).map((slot) => slot.open),
      ).toEqual([stretch(0, 360), stretch(360, 720), stretch(720, 1080), stretch(1080, 1440)]);
      const anna = read.agency?.coverage.find((one) => one.platformAccountId === annaAccount);
      expect((anna?.withAgent ?? -1) + (anna?.chatterAlone ?? -1)).toBe(0);
    } finally {
      await setStatus(theo, 'active');
    }
  });

  it('filters by creator and by member, never beyond what the reader may read', async () => {
    const annaOnly = await calendar(owner, { creatorId: anna });
    expect(annaOnly.shifts.map((shift) => shift.creatorId)).toEqual([anna]);
    expect(annaOnly.creators.map((one) => one.name)).toEqual(['Anna']);
    expect(annaOnly.agent.map((agent) => agent.creatorId)).toEqual([anna]);
    expect(annaOnly.agency?.accounts.map((account) => account.id)).toEqual([annaAccount]);
    const basileOnly = await calendar(theoCookie, { memberId: basile.id });
    expect(basileOnly.shifts.map((shift) => shift.memberId)).toEqual([basile.id]);
  });

  it('counts a créneau the agent holds alone in Automatique apart, and none under Arrêt', async () => {
    await expectSameModeAsDashboard(await calendar(owner));
    const fanId = newId(FanIdSchema);
    await test.admin.db.insert(schema.fans).values({
      id: fanId,
      creatorId: ines,
      platformAccountId: inesAccount,
      platformFanId: 'fan-invente',
      displayName: 'Fan inventé',
    });
    await test.admin.db.insert(schema.conversations).values({
      id: newId(ConversationIdSchema),
      creatorId: ines,
      platformAccountId: inesAccount,
      fanId,
      platformConversationId: 'conv-inventee',
      mode: 'auto',
    });
    const auto = await calendar(owner);
    await expectSameModeAsDashboard(auto);
    expect(auto.agent.find((agent) => agent.creatorId === ines)?.mode).toBe('auto');
    // 0–6, 6–12, 12–18 on Inès are the agent's alone; 18–24, where Basile chats 20–23, keeps its holes to fill even
    // with the agent answering them: « IA seule » is « sans chatteur » only (ADR 0048 § 1).
    expect(auto.agency?.aiAlone.filter((slot) => slot.platformAccountId === inesAccount)).toHaveLength(3);
    expect(
      auto.agency?.toFill
        .filter((slot) => slot.platformAccountId === inesAccount)
        .map((slot) => slot.startsAt),
    ).toEqual([parisInstant(day, 1080).toISOString()]);
    const inesCoverage = auto.agency?.coverage.find((one) => one.platformAccountId === inesAccount);
    expect(inesCoverage).toEqual({
      platformAccountId: inesAccount,
      withAgent: 180,
      chatterAlone: 0,
      agentAlone: DAY_MINUTES - 180,
      nobody: 0,
    });

    await test.admin.db.insert(schema.killSwitches).values({
      id: newId(KillSwitchIdSchema),
      scope: 'global',
      active: true,
      reason: 'essai',
      setBy: 'owner',
    });
    const stopped = await calendar(owner);
    expect(stopped.agent.map((agent) => agent.mode)).toEqual(['stop', 'stop']);
    expect(stopped.agent.map((agent) => agent.answers)).toEqual([[], []]);
    await expectSameModeAsDashboard(stopped);
    expect(stopped.agency?.aiAlone).toEqual([]);
    expect(stopped.agency?.toFill).toHaveLength(8);
  });

  it('refuses a window over six weeks, and a creator', async () => {
    const query = new URLSearchParams({
      from: iso(from),
      to: iso(new Date(from.getTime() + 43 * DAY_MINUTES * 60_000)),
    });
    const tooLong = await call(`/scheduling/calendar?${query.toString()}`, owner);
    expect(tooLong.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(tooLong.json()).error.code).toBe('planning_range_invalid');
    const asCreator = await call(
      `/scheduling/calendar?${new URLSearchParams({ from: iso(from), to: iso(to) }).toString()}`,
      creator,
    );
    expect(asCreator.statusCode).toBe(403);
  });
});
