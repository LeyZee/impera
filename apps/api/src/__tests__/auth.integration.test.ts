import { newId, TeamMemberIdSchema } from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };

describe('dashboard authentication (P0-07a)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let operatorId = '';

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    const ownerOnly: FastifyPluginAsyncZod = (routes) => {
      routes.post('/owner-only', { preValidation: app.requireRole('owner') }, () => ({ ok: true }));
      return Promise.resolve();
    };
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: [...app.routes, ownerOnly],
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    operatorId = (await createOwner(app.auth, app.db.db, OPERATOR)).userId;
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, operatorId));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('answers 401 without a session', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('session_unauthenticated');
  });

  it('answers 401 before reading the body: an anonymous request never learns the fields a route expects', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/creators',
      payload: { nope: true },
      headers: { origin: DASHBOARD_ORIGIN },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('session_unauthenticated');
    const query = await server.inject({ method: 'GET', url: '/v1/conversations' });
    expect(query.statusCode).toBe(401);
  });

  it('serves only sign-in and sign-out of Better Auth: no session token to read, no account to rename', async () => {
    const cookie = await signIn(server, OWNER.email, OWNER.password);
    const headers = { cookie, origin: DASHBOARD_ORIGIN };
    for (const [method, url] of [
      ['GET', '/v1/auth/get-session'],
      ['GET', '/v1/auth/list-sessions'],
      ['POST', '/v1/auth/update-user'],
    ] as const) {
      const response = await server.inject({
        method,
        url,
        headers,
        ...(method === 'POST' && { payload: { name: 'X' } }),
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('token');
    }
    const [row] = await test.admin.db.select().from(schema.user).where(eq(schema.user.email, OWNER.email));
    expect(row?.name).toBe(OWNER.name);
  });

  it('signs in, tells who is signed in, and records the login', async () => {
    const cookie = await signIn(server, OWNER.email, OWNER.password);
    const me = await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: OWNER.email, role: 'owner', creatorIds: [] });
    expect(me.json<{ id: string }>().id).toMatch(/^[0-9a-f-]{36}$/);

    const logins = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.login'));
    expect(logins.length).toBeGreaterThanOrEqual(1);
  });

  it('tells the team role and the scope the database applies (ADR 0024)', async () => {
    const owner = await signIn(server, OWNER.email, OWNER.password);
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    const meOf = async (cookie: string) =>
      (await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).json<{
        team: { role: string; status: string } | null;
        teamScope: string;
      }>();
    expect(await meOf(owner)).toMatchObject({ team: null, teamScope: 'owner' });
    expect(await meOf(operator)).toMatchObject({ team: null, teamScope: 'self' });

    // Invented member (ADR 0010).
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: operatorId,
      teamRole: 'manager',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Manager',
      country: 'MG',
      timeZone: 'Indian/Antananarivo',
      joinedOn: '2026-10-01',
    });
    const setMember = (values: { teamRole?: string; status?: string }) =>
      test.admin.db.update(schema.teamMembers).set(values).where(eq(schema.teamMembers.userId, operatorId));
    expect(await meOf(operator)).toMatchObject({
      team: { role: 'manager', status: 'active' },
      teamScope: 'agency',
    });
    await setMember({ status: 'on_leave' });
    expect(await meOf(operator)).toMatchObject({
      team: { role: 'manager', status: 'on_leave' },
      teamScope: 'self',
    });
    await setMember({ teamRole: 'chatter', status: 'active' });
    expect(await meOf(operator)).toMatchObject({
      team: { role: 'chatter', status: 'active' },
      teamScope: 'self',
    });
    await test.admin.db.delete(schema.teamMembers).where(eq(schema.teamMembers.userId, operatorId));
  });

  it('closes the door to a member who left: no sign-in, and a session still open is refused at once (ADR 0023)', async () => {
    // Invented member (ADR 0010).
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: operatorId,
      teamRole: 'chatter',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Chatteur',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    const owner = await signIn(server, OWNER.email, OWNER.password);
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    const me = (cookie: string) => server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect((await me(operator)).statusCode).toBe(200);

    // Marked left without going through the route (a job, another instance): his session is not revoked yet.
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'left' })
      .where(eq(schema.teamMembers.userId, operatorId));
    const refused = await me(operator);
    expect(refused.statusCode).toBe(401);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('session_unauthenticated');
    await expect(signIn(server, OPERATOR.email, OPERATOR.password)).rejects.toThrow(
      /401.*sign_in_unauthenticated.*E-mail ou mot de passe incorrect/,
    );
    // The owner has no team row and is never cut off.
    expect((await me(owner)).statusCode).toBe(200);

    // Back to active (as an untouched member): signing in works again.
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'active' })
      .where(eq(schema.teamMembers.userId, operatorId));
    expect((await me(await signIn(server, OPERATOR.email, OPERATOR.password))).statusCode).toBe(200);
    await test.admin.db.delete(schema.teamMembers).where(eq(schema.teamMembers.userId, operatorId));
  });

  it('refuses a wrong password and an unknown e-mail with one French answer', async () => {
    for (const [email, password] of [
      // On the operator: the owner's account already counts many sign-ins against its limit in this file.
      [OPERATOR.email, 'not the password at all'],
      ['nobody@example.test', 'not the password at all'],
    ] as const) {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/email',
        payload: { email, password },
        headers: { origin: DASHBOARD_ORIGIN },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
        code: 'sign_in_unauthenticated',
        message: 'E-mail ou mot de passe incorrect',
      });
    }
  });

  it('sets the session cookie HttpOnly and SameSite=Lax, and keeps the token out of the body', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      payload: { email: OWNER.email, password: OWNER.password },
      headers: { origin: DASHBOARD_ORIGIN },
    });
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // The token lives in the cookie only, never in a body the page's JavaScript can read.
    expect(response.json()).not.toHaveProperty('token');
    expect(response.json()).toMatchObject({ user: { email: OWNER.email } });
  });

  it('refuses a wrong password', async () => {
    await expect(signIn(server, OWNER.email, 'not the password at all')).rejects.toThrow(/401/);
  });

  it('answers 403 to an operator on an owner route, 200 to the owner', async () => {
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    const owner = await signIn(server, OWNER.email, OWNER.password);
    const call = (cookie: string, origin = DASHBOARD_ORIGIN) =>
      server.inject({ method: 'POST', url: '/v1/owner-only', headers: { cookie, origin } });

    const refused = await call(operator);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('role_forbidden');
    expect((await call(owner)).statusCode).toBe(200);
    // Signed in but from another site: the Origin check comes first.
    expect((await call(owner, 'https://evil.example')).statusCode).toBe(403);
  });

  it('has no public sign-up', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/auth/sign-up/email',
      payload: { email: 'intruder@example.test', name: 'X', password: 'a long enough password' },
      headers: { origin: DASHBOARD_ORIGIN },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const users = await test.admin.db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, 'intruder@example.test'));
    expect(users).toEqual([]);
  });

  it('signs out and the session stops working', async () => {
    const cookie = await signIn(server, OWNER.email, OWNER.password);
    const out = await server.inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
    expect(out.statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it("answers Better Auth's own refusals in the common format, in French (recette 28/10)", async () => {
    // From an address of its own: the other tests of this file already spend most of the per-IP limit on `/auth`.
    const post = (url: string, payload: object) =>
      server.inject({
        method: 'POST',
        url,
        payload,
        headers: { origin: DASHBOARD_ORIGIN },
        remoteAddress: '192.0.2.10',
      });
    for (const response of [
      await post('/v1/auth/sign-in/email', { email: 'not-an-email', password: 'whatever it is' }),
      await post('/v1/auth/sign-in/email', { email: 'nobody-else@example.test' }),
      await post('/v1/auth/sign-out', { disableRedirect: 'yes' }),
    ]) {
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
        code: 'request_invalid',
        message: 'Requête invalide',
      });
    }
    // Signing out without a session closes nothing and says so plainly.
    expect((await post('/v1/auth/sign-out', {})).statusCode).toBe(200);
  });

  it("closes the session a new sign-in of the same account replaces, never another account's", async () => {
    const SECOND = { email: 'second@example.test', name: 'Second', password: 'battery staple correct' };
    const { userId } = await createOwner(app.auth, app.db.db, SECOND);
    const sessions = async () =>
      (
        await test.admin.db
          .select({ id: schema.session.id })
          .from(schema.session)
          .where(eq(schema.session.userId, userId))
      ).length;
    const me = (cookie: string) => server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    const signInFrom = async (cookie: string, account: { email: string; password: string }) => {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/email',
        payload: { email: account.email, password: account.password },
        headers: { cookie, origin: DASHBOARD_ORIGIN },
        // An address of its own, like above: the per-IP limit on `/auth` is shared by the whole file.
        remoteAddress: '192.0.2.11',
      });
      expect(response.statusCode).toBe(200);
      return String(response.headers['set-cookie']).split(';')[0] ?? '';
    };

    const first = await signInFrom('', SECOND);
    expect(await sessions()).toBe(1);
    // The password confirmed again before a sensitive action (ADR 0016): one session still, the new one.
    const confirmed = await signInFrom(first, SECOND);
    expect(await sessions()).toBe(1);
    expect((await me(first)).statusCode).toBe(401);
    expect((await me(confirmed)).statusCode).toBe(200);
    // Another account signing in from that browser leaves this one's session to its own sign-out.
    await signInFrom(confirmed, OPERATOR);
    expect(await sessions()).toBe(1);
  });

  it('asks for the password again before touching an AI key with a session older than 10 minutes', async () => {
    const cookie = await signIn(server, OWNER.email, OWNER.password);
    const headers = { cookie, origin: DASHBOARD_ORIGIN };
    const remove = () => server.inject({ method: 'DELETE', url: '/v1/settings/providers/xai', headers });
    expect((await remove()).statusCode).toBe(200);

    await test.admin.db.execute(
      sql`update "session" set created_at = now() - interval '11 minutes' where user_id = (select id from "user" where email = ${OWNER.email})`,
    );
    const stale = await remove();
    expect(stale.statusCode).toBe(403);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('reauthentication_forbidden');
    // Reading stays open; only connecting, replacing and removing a key ask again.
    expect((await server.inject({ method: 'GET', url: '/v1/settings/providers', headers })).statusCode).toBe(
      200,
    );

    const fresh = await signIn(server, OWNER.email, OWNER.password);
    const again = await server.inject({
      method: 'DELETE',
      url: '/v1/settings/providers/xai',
      headers: { cookie: fresh, origin: DASHBOARD_ORIGIN },
    });
    expect(again.statusCode).toBe(200);
  });

  it('refuses a second account with the same email and a short password', async () => {
    await expect(createOwner(app.auth, app.db.db, OWNER)).rejects.toThrow(/existe déjà/);
    await expect(
      createOwner(app.auth, app.db.db, { email: 'short@example.test', name: 'S', password: 'short' }),
    ).rejects.toThrow(/trop court/);
  });
});
