import { randomUUID } from 'node:crypto';

import {
  CreatorIdSchema,
  CreatorSetupListSchema,
  MemberSetupListSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type TeamMemberId,
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

/**
 * « Mise en route » (pilotage plan W1) through the real app: each step ticked from the base, never by a click, for the
 * owner alone. Everything is invented (ADR 0010).
 */
describe('GET /v1/dashboard/setup/creators and /members, « Mise en route »', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let bare: CreatorId;
  let account: PlatformAccountId;
  let theo: TeamMemberId;
  let ownerId: string;
  type Who = 'owner' | 'manager' | 'chatter' | 'creator';
  const cookies = new Map<Who, string>();

  const get = (who: Who | null, path: string) =>
    server.inject({
      method: 'GET',
      url: `/v1/dashboard/setup/${path}`,
      headers: { origin: DASHBOARD_ORIGIN, ...(who === null ? {} : { cookie: cookies.get(who) }) },
    });
  const creators = async () => {
    const answer = await get('owner', 'creators');
    expect(answer.statusCode, answer.body).toBe(200);
    return CreatorSetupListSchema.parse(answer.json()).creators;
  };
  const stepsOf = async (creatorId: CreatorId) =>
    Object.fromEntries(
      ((await creators()).find((c) => c.creatorId === creatorId)?.steps ?? []).map((s) => [s.key, s.state]),
    );

  async function person(key: Exclude<Who, 'owner'>, role: 'operator' | 'creator', ids: readonly CreatorId[]) {
    const email = `${key}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: key, password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role, creatorIds: [...ids] })
      .where(eq(schema.user.id, userId));
    cookies.set(key, await signIn(server, email, PASSWORD));
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

    nora = newId(CreatorIdSchema);
    bare = newId(CreatorIdSchema);
    account = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: bare, nameKey: 'sans-rien', displayName: 'Sans rien', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: nora, platform: 'reveal', handle: 'creatrice_test' });

    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    }));
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    await member(await person('manager', 'operator', [nora]), 'manager', 'Maya');
    theo = await member(await person('chatter', 'operator', [nora]), 'chatter', 'Théo');
    await person('creator', 'creator', [nora]);
    await test.admin.db
      .insert(schema.salesFeedChatters)
      .values({ platform: 'reveal', platformChatterId: 'chatter_theo', kind: 'member', memberId: theo });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('is the owner’s alone', async () => {
    for (const path of ['creators', 'members']) {
      expect((await get(null, path)).statusCode).toBe(401);
      for (const who of ['manager', 'chatter', 'creator'] as const) {
        expect((await get(who, path)).statusCode, `${who} ${path}`).toBe(403);
      }
    }
  });

  it('reads what a creator has, and what she does not', async () => {
    expect(await stepsOf(bare)).toMatchObject({
      platform_account: 'todo',
      persona: 'todo',
      agency_rate: 'todo',
      access: 'todo',
      pay_rules: 'todo',
      shifts: 'todo',
      agent_hours: 'done',
      agent_mode: 'done',
      reliability_check: 'todo',
    });
    // Her own account, made and signed in with: her invitation is used.
    expect(await stepsOf(nora)).toMatchObject({
      platform_account: 'done',
      access: 'done',
      pay_rules: 'todo',
    });
  });

  it('ticks a step as soon as the base holds it', async () => {
    await test.admin.db
      .insert(schema.creatorAgencyRates)

      .values({
        id: randomUUID(),
        creatorId: nora,
        fromDay: '2026-10-01',
        agencyBps: 4500,
        createdBy: ownerId,
      });
    await test.admin.db.insert(schema.accountPayRules).values({
      id: randomUUID(),
      creatorId: nora,
      platformAccountId: account,
      fromPeriod: '2026-10-01',
      currency: 'EUR',
      vatBps: 2000,
      platformFeeBps: 2000,
      earningsSource: 'detected',
      createdBy: ownerId,
    });
    const starts = new Date(Date.now() + 86_400_000);
    starts.setUTCSeconds(0, 0);
    await test.admin.db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: nora,
      platformAccountId: account,
      memberId: theo,
      startsAt: starts,
      endsAt: new Date(starts.getTime() + 4 * 3_600_000),
      createdBy: ownerId,
      updatedBy: ownerId,
    });
    const today = new Date().toISOString().slice(0, 10);
    await test.admin.db.insert(schema.salesFeedChecks).values({
      id: randomUUID(),
      platform: 'reveal',
      fromDay: '2026-10-01',
      toDay: today,
      verdict: 'match',
      clean: true,
      report: {},
      generatedAt: new Date(),
    });
    expect(await stepsOf(nora)).toMatchObject({
      agency_rate: 'done',
      pay_rules: 'done',
      shifts: 'done',
      reliability_check: 'done',
    });
    // A later check that is not clean takes the tick back.
    await test.admin.db.insert(schema.salesFeedChecks).values({
      id: randomUUID(),
      platform: 'reveal',
      fromDay: '2026-10-01',
      toDay: today,
      verdict: 'mismatch',
      clean: false,
      report: {},
      generatedAt: new Date(Date.now() + 1000),
    });
    const check = (await creators())
      .find((c) => c.creatorId === nora)
      ?.steps.find((s) => s.key === 'reliability_check');
    expect(check).toEqual({ key: 'reliability_check', state: 'todo', note: { kind: 'check_not_clean' } });
  });

  it('reads each member’s arrival', async () => {
    const answer = await get('owner', 'members');
    expect(answer.statusCode, answer.body).toBe(200);
    const members = MemberSetupListSchema.parse(answer.json()).members;
    const of = (role: 'manager' | 'chatter') =>
      Object.fromEntries(
        (members.find((m) => m.teamRole === role)?.steps ?? []).map((s) => [s.key, s.state]),
      );
    // Both signed in with their authenticator code (the test's sign-in sets one up).
    expect(of('manager')).toEqual({ invitation: 'done', second_factor: 'done', creators: 'done' });
    expect(of('chatter')).toEqual({
      invitation: 'done',
      second_factor: 'done',
      extension: 'todo',
      platform_account: 'done',
      creators: 'done',
      first_shift: 'done',
    });
  });
});
