import { newId, TeamMemberIdSchema, UserIdSchema } from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented accounts (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MANAGER = { email: 'manager@example.test', name: 'Manager', password: 'staple battery horse' };
const CHATTER = { email: 'chatter@example.test', name: 'Chatter', password: 'battery horse staple' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'horse staple battery' };

const SessionStateSchema = z.object({ state: z.string() });
const RowSchema = z.object({ updated_at: z.coerce.date(), expires_at: z.coerce.date() });
const HOUR = 60 * 60 * 1000;

/**
 * How long a session lives by role (SEC-17): the owner 48 h without activity, every other role 12 h, all 7 days at
 * most; never a recent sign-in. Times are moved in the base, as Better Auth reads its own clock: `updated_at` is the
 * last refresh, `expires_at` what Better Auth wrote then (48 h later; 12 h for a row written before SEC-17).
 */
describe('session lifetime by role (SEC-17)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;

  const userIdOf = async (email: string) => {
    const [row] = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (row === undefined) throw new Error(`no account ${email}`);
    return row.id;
  };
  const sessionCount = async (email: string) =>
    (
      await test.admin.db.execute(
        sql`select 1 from "session" where user_id = (select id from "user" where email = ${email})`,
      )
    ).rows.length;
  const sessionRow = async (email: string) =>
    RowSchema.parse(
      (
        await test.admin.db.execute(
          sql`select updated_at, expires_at from "session" where user_id = (select id from "user" where email = ${email})`,
        )
      ).rows[0],
    );
  /**
   * One session for the account, freshly signed in: every other is dropped so each test reads its own row (the first
   * sign-in, which activates the code, leaves one more behind).
   */
  const freshSession = async (account: { email: string; password: string }) => {
    const cookie = await signIn(server, account.email, account.password);
    const token = /session_token=([^.;]+)\./.exec(cookie)?.[1];
    if (token === undefined) throw new Error(`no session cookie for ${account.email}`);
    await test.admin.db.execute(
      sql`delete from "session"
          where user_id = (select id from "user" where email = ${account.email}) and token <> ${token}`,
    );
    return cookie;
  };
  /** Its last refresh `idle` ago and its expiry `expiresIn` ahead (both Postgres intervals), its creation `age` ago. */
  const setTimes = (email: string, times: { idle: string; expiresIn: string; age?: string }) =>
    test.admin.db.execute(
      sql`update "session" set updated_at = now() - ${times.idle}::interval,
            expires_at = now() + ${times.expiresIn}::interval,
            created_at = now() - ${times.age ?? '1 day'}::interval
          where user_id = (select id from "user" where email = ${email})`,
    );
  const me = (cookie: string) => server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
  const dashboardSession = async (cookie: string) =>
    SessionStateSchema.parse(
      (await server.inject({ method: 'GET', url: '/v1/session', headers: { cookie } })).json(),
    ).state;

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
    for (const [account, teamRole] of [
      [MANAGER, 'manager'],
      [CHATTER, 'chatter'],
    ] as const) {
      const { userId } = await createOwner(app.auth, app.db.db, account);
      await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: account.name,
        country: 'MG',
        timeZone: 'Indian/Antananarivo',
        joinedOn: '2026-10-01',
      });
    }
    const creatorId = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    const creator = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, creator.userId));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('keeps an owner session idle 47 hours, ends one idle 49 hours', async () => {
    const cookie = await freshSession(OWNER);
    await setTimes(OWNER.email, { idle: '47 hours', expiresIn: '1 hour' });
    expect((await me(cookie)).statusCode).toBe(200);
    // Used again: refreshed for another 48 hours.
    const refreshed = await sessionRow(OWNER.email);
    expect(refreshed.expires_at.getTime() - Date.now()).toBeGreaterThan(47 * HOUR);

    await setTimes(OWNER.email, { idle: '49 hours', expiresIn: '-1 hour' });
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await sessionCount(OWNER.email)).toBe(0);
  });

  it('ends an owner session 7 days after its creation, even used a minute ago', async () => {
    const cookie = await freshSession(OWNER);
    await setTimes(OWNER.email, { idle: '1 minute', expiresIn: '47 hours', age: '6 days 23 hours' });
    expect((await me(cookie)).statusCode).toBe(200);
    await setTimes(OWNER.email, { idle: '1 minute', expiresIn: '47 hours', age: '7 days 1 minute' });
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await sessionCount(OWNER.email)).toBe(0);
  });

  it('keeps a manager, a chatter or a creator idle 11 hours, and closes one idle 13 hours', async () => {
    for (const account of [MANAGER, CHATTER, CREATOR]) {
      const cookie = await freshSession(account);
      await setTimes(account.email, { idle: '11 hours', expiresIn: '37 hours' });
      expect(await dashboardSession(cookie)).toBe('signed_in');
      // The refresh moved its last activity to now.
      expect(Date.now() - (await sessionRow(account.email)).updated_at.getTime()).toBeLessThan(HOUR);

      // Better Auth alone would keep it 35 hours more, and refresh it as if used just now.
      await setTimes(account.email, { idle: '13 hours', expiresIn: '35 hours' });
      expect(await dashboardSession(cookie)).toBe('signed_out');
      expect(await sessionCount(account.email)).toBe(0);
      expect((await me(cookie)).statusCode).toBe(401);
    }
  });

  it('never revives a session idle past its limit through a route Better Auth reads it on itself', async () => {
    const cookie = await freshSession(MANAGER);
    await setTimes(MANAGER.email, { idle: '13 hours', expiresIn: '35 hours' });
    // The passkey sign-in options read the session of the cookie, with no guard of ours before.
    await server.inject({
      method: 'GET',
      url: '/v1/auth/passkey/generate-authenticate-options',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
    expect(await sessionCount(MANAGER.email)).toBe(0);
    expect(await dashboardSession(cookie)).toBe('signed_out');
  });

  it('keeps a session written before SEC-17 (12 hours ahead) and gives it the new lifetime', async () => {
    const cookie = await freshSession(MANAGER);
    await setTimes(MANAGER.email, { idle: '2 hours', expiresIn: '10 hours' });
    expect((await me(cookie)).statusCode).toBe(200);
    expect((await sessionRow(MANAGER.email)).expires_at.getTime() - Date.now()).toBeGreaterThan(47 * HOUR);
  });

  it('renews the cookie with the session, so a browser keeps a session in use past 48 hours', async () => {
    const cookie = await freshSession(OWNER);
    await setTimes(OWNER.email, { idle: '2 hours', expiresIn: '46 hours', age: '3 days' });
    const response = await me(cookie);
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toMatch(/session_token=[^;]+;.*Max-Age=172800/);
    // Not due again within the hour: no cookie.
    expect((await me(cookie)).headers['set-cookie']).toBeUndefined();
  });

  it('never counts a long session as a recent sign-in: a sensitive action asks again', async () => {
    const cookie = await freshSession(OWNER);
    const headers = { cookie, origin: DASHBOARD_ORIGIN };
    const remove = () => server.inject({ method: 'DELETE', url: '/v1/settings/providers/xai', headers });
    // Six days old, used all along, its password and code given at the sign-in six days ago.
    await setTimes(OWNER.email, { idle: '10 minutes', expiresIn: '47 hours', age: '6 days' });
    await test.admin.db
      .update(schema.session)
      .set({
        reauthenticatedAt: sql`now() - interval '6 days'`,
        codeConfirmedAt: sql`now() - interval '6 days'`,
      })
      .where(eq(schema.session.userId, await userIdOf(OWNER.email)));
    expect((await me(cookie)).statusCode).toBe(200);
    const refused = await remove();
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('reauthentication_forbidden');

    // Opened from a trusted device or by a passkey: nothing was ever confirmed on it.
    await test.admin.db
      .update(schema.session)
      .set({ reauthenticatedAt: null, codeConfirmedAt: null })
      .where(eq(schema.session.userId, await userIdOf(OWNER.email)));
    expect((await remove()).json<{ error: { code: string } }>().error.code).toBe(
      'reauthentication_forbidden',
    );
  });

  it('lists an operator’s own sessions alive only, an idle one gone from the list', async () => {
    const cookie = await freshSession(CHATTER);
    const userId = await userIdOf(CHATTER.email);
    // A second session of his, idle 13 hours, not yet read again.
    await test.admin.db.execute(
      sql`insert into "session" (id, token, user_id, expires_at, created_at, updated_at)
          values (${newId(UserIdSchema)}, 'invented-idle-token', ${userId}, now() + interval '35 hours',
                  now() - interval '1 day', now() - interval '13 hours')`,
    );
    const listed = await server.inject({ method: 'GET', url: '/v1/auth/sessions', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ sessions: unknown[] }>().sessions).toHaveLength(1);
  });
});
