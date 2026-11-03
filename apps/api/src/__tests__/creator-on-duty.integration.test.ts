import {
  CreatorIdSchema,
  CreatorOnDutyListSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
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
const HOUR = 3_600_000;

/**
 * « Qui est en poste » for the creator (CR-02, ADR 0023): who chats for her now and in the next 24 hours, by display
 * name and range only, through her own door. Invented data only (ADR 0010).
 */
describe('GET /v1/creator-space/on-duty', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorCookie: string;
  let operatorCookie: string;

  async function get(cookie: string) {
    return server.inject({
      method: 'GET',
      url: '/v1/creator-space/on-duty',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
  }

  async function account(email: string, set: { role: 'creator' | 'operator'; creatorIds: string[] }) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
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
    const creators: { creatorId: CreatorId; accountId: string; handle: string }[] = [];
    for (const label of ['nora', 'ines']) {
      const creatorId = newId(CreatorIdSchema);
      const accountId = newId(PlatformAccountIdSchema);
      await test.admin.db
        .insert(schema.creators)
        .values({ id: creatorId, nameKey: creatorId, displayName: label, timezone: 'Europe/Paris' });
      await test.admin.db
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId, platform: 'reveal', handle: `${label}-reveal` });
      creators.push({ creatorId, accountId, handle: `${label}-reveal` });
    }
    const [nora, ines] = creators;
    if (nora === undefined || ines === undefined) throw new Error('seed failed');
    const owner = await account('owner@example.test', { role: 'operator', creatorIds: [] });
    const members = new Map<string, string>();
    for (const [name, status] of [
      ['Kofi', 'active'],
      ['Awa', 'active'],
      ['Yao', 'active'],
      ['Ama', 'sick'],
    ] as const) {
      const userId = newId(UserIdSchema);
      const memberId = newId(TeamMemberIdSchema);
      await test.admin.db.insert(schema.user).values({ id: userId, name, email: `${name}@example.test` });
      await test.admin.db.insert(schema.teamMembers).values({
        id: memberId,
        userId,
        teamRole: 'chatter',
        firstName: name,
        lastName: 'Inventé',
        displayName: name,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-09-01',
        status,
      });
      members.set(name, memberId);
    }
    const minute = 60_000;
    const base = Math.floor(Date.now() / minute) * minute;
    const shift = (name: string, creator: typeof nora, from: number, to: number, cancelled = false) => ({
      id: newId(ShiftIdSchema),
      creatorId: creator.creatorId,
      platformAccountId: creator.accountId,
      memberId: members.get(name) ?? '',
      startsAt: new Date(base + from * HOUR),
      endsAt: new Date(base + to * HOUR),
      cancelledAt: cancelled ? new Date() : null,
      createdBy: owner.userId,
      updatedBy: owner.userId,
    });
    await test.admin.db.insert(schema.shifts).values([
      shift('Kofi', nora, -1, 2),
      shift('Awa', nora, 5, 9),
      // Too far ahead, cancelled, on a member who is not active, on another creator: none of hers to see.
      shift('Kofi', nora, 30, 34),
      shift('Yao', nora, 3, 4, true),
      shift('Ama', nora, 3, 4),
      shift('Yao', ines, -1, 2),
    ]);
    ({ cookie: creatorCookie } = await account('nora@example.test', {
      role: 'creator',
      creatorIds: [nora.creatorId],
    }));
    ({ cookie: operatorCookie } = await account('ope@example.test', {
      role: 'operator',
      creatorIds: [nora.creatorId],
    }));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('says who chats for her now and in the next 24 hours, by display name, account and range only', async () => {
    const response = await get(creatorCookie);
    expect(response.statusCode, response.body).toBe(200);
    const body = CreatorOnDutyListSchema.parse(response.json());
    expect(body.current.map((s) => [s.displayName, s.handle])).toEqual([['Kofi', 'nora-reveal']]);
    expect(body.next.map((s) => [s.displayName, s.handle])).toEqual([['Awa', 'nora-reveal']]);
    expect(response.body).not.toMatch(/"memberId"|"country"|"status"|"rate/u);
  });

  it('is for a creator’s account only', async () => {
    const response = await get(operatorCookie);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'role_forbidden' } });
  });
});
