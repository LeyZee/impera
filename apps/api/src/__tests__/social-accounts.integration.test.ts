import {
  newId,
  SocialAccountIdSchema,
  SocialAccountListSchema,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

// Invented accounts, creators and user names (ADR 0143 § 7: her real accounts live in the CRM only).
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MANAGER = { email: 'manager@example.test', name: 'Manager', password: 'staple battery horse' };
const CHATTER = { email: 'chatter@example.test', name: 'Chatter', password: 'horse staple battery' };
const ANNA = { email: 'anna@example.test', name: 'Anna', password: 'battery staple horse' };

describe('« Ses comptes » (ADR 0143 § C, bounds 18 to 20)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let manager: string;
  let chatter: string;
  let anna: string;
  let annaId: CreatorId;

  const read = (cookie: string) =>
    server.inject({ method: 'GET', url: `/v1/creators/${annaId}/social-accounts`, headers: { cookie } });
  const put = (cookie: string, accounts: object[]) =>
    server.inject({
      method: 'PUT',
      url: `/v1/creators/${annaId}/social-accounts`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload: { accounts },
    });
  const account = async (who: typeof OWNER, role: 'operator' | 'creator', creatorIds: string[]) => {
    const { userId } = await createOwner(app.auth, app.db.db, who);
    await test.admin.db.update(schema.user).set({ role, creatorIds }).where(eq(schema.user.id, userId));
    return userId;
  };
  const member = (userId: string, teamRole: 'manager' | 'chatter') =>
    test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: teamRole,
      country: 'MG',
      timeZone: 'Indian/Antananarivo',
      joinedOn: '2026-10-01',
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
    await createOwner(app.auth, app.db.db, OWNER);
    annaId = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    await member(await account(MANAGER, 'operator', [annaId]), 'manager');
    await member(await account(CHATTER, 'operator', [annaId]), 'chatter');
    await account(ANNA, 'creator', [annaId]);
    owner = await signIn(server, OWNER.email, OWNER.password);
    manager = await signIn(server, MANAGER.email, MANAGER.password);
    chatter = await signIn(server, CHATTER.email, CHATTER.password);
    anna = await signIn(server, ANNA.email, ANNA.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const lives = {
    id: newId(SocialAccountIdSchema),
    platform: 'tiktok',
    username: '@demo.lives',
    usage: 'lives',
  };
  const practice = {
    id: newId(SocialAccountIdSchema),
    platform: 'instagram',
    username: 'demo_atelier',
    usage: 'practice',
  };

  it('stores the owner’s list in order, off by default, and gives the agent only the marked ones', async () => {
    const sent = await put(owner, [lives, { ...practice, agentMayShare: true }]);
    expect(sent.statusCode, sent.body).toBe(200);
    const stored = SocialAccountListSchema.parse(sent.json()).accounts;
    expect(stored.map((a) => [a.username, a.agentMayShare])).toEqual([
      ['demo.lives', false],
      ['demo_atelier', true],
    ]);
    const shareable = await app.modules.persona.socialAccounts.shareable(annaId);
    expect(shareable.map((a) => a.username)).toEqual(['demo_atelier']);
  });

  it('audits each change of « l’agent peut le donner », never a user name', async () => {
    expect((await put(owner, [{ ...lives, agentMayShare: true }])).statusCode).toBe(200);
    const lines = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.entity, 'social_account')));
    expect(lines.map((line) => [line.action, line.entityId])).toEqual(
      expect.arrayContaining([
        ['social_account.share_on', practice.id],
        ['social_account.share_on', lives.id],
        ['social_account.share_off', practice.id],
      ]),
    );
    expect(JSON.stringify(lines.map((line) => line.details))).not.toContain('demo');
  });

  it('lets a manager read, never change; closes them to a chatter and to her own account', async () => {
    expect((await read(manager)).statusCode).toBe(200);
    expect((await put(manager, [lives])).statusCode).toBe(403);
    expect((await read(chatter)).statusCode).toBe(403);
    expect((await read(anna)).statusCode).toBe(403);
    expect((await put(anna, [lives])).statusCode).toBe(403);
  });

  it('refuses a link or a space in a user name', async () => {
    expect((await put(owner, [{ ...lives, username: 'https://example.com/demo' }])).statusCode).toBe(400);
    expect((await put(owner, [{ ...lives, username: 'demo lives' }])).statusCode).toBe(400);
  });
});
