import { Writable } from 'node:stream';

import { CreatorIdSchema, TeamMemberIdSchema, UserIdSchema, newId } from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createPasswordResetRoutes, issuePasswordResetLink } from '../password-reset';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn, signInWithoutCode } from './support/sign-in';

// Invented people only (ADR 0010).
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const NEW_PASSWORD = 'une toute nouvelle phrase de passe';
/** The one password the test's breach check knows (ADR 0046 § 4); the real service is never called. */
const BREACHED = 'un mot de passe déjà fuité';

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

/**
 * SEC-05 lot 3, ADR 0068 §§ 2–5 amended 27/11/2026: the link is made on the server (`pnpm ops:password-reset-link`) and
 * printed there; nothing is asked from the sign-in page any more, nothing is sent to Telegram.
 */
describe('forgotten password', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let resets: Server;
  let ownerId = '';
  const logs: string[] = [];
  let address = 0;
  let webOrigin = '';

  const post = (target: Server, url: string, payload: Record<string, unknown>) =>
    target.inject({
      method: 'POST',
      url,
      payload,
      headers: { origin: DASHBOARD_ORIGIN },
      remoteAddress: `10.1.${String(Math.floor(address / 250))}.${String((address++ % 250) + 1)}`,
    });

  /** The server's command line. */
  const ask = (email: string) => issuePasswordResetLink(app.adminDb.db, email, webOrigin);

  const tokenOf = (text: string): string => {
    const match = /\/mot-de-passe-oublie#t=([A-Za-z0-9_-]{43})/u.exec(text);
    if (match?.[1] === undefined) throw new Error('no link');
    return match[1];
  };

  async function auditOf(userId: string | null) {
    return test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        userId === null
          ? sql`${schema.auditLog.userId} is null and ${schema.auditLog.entity} = 'password_reset_link'`
          : eq(schema.auditLog.userId, userId),
      )
      .orderBy(schema.auditLog.createdAt);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      LOG_LEVEL: 'info',
    });
    webOrigin = config.WEB_ORIGIN;
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger, {
      passwordBreaches: (password) => Promise.resolve(password === BREACHED),
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    resets = await buildServer({
      config,
      logger,
      readiness: app.readiness,
      routes: [
        createPasswordResetRoutes({
          auth: app.auth,
          adminDb: app.adminDb.db,
          passwordBreaches: (password) => Promise.resolve(password === BREACHED),
        }),
      ],
    });
    await createOwner(app.auth, app.db.db, OWNER);
    const [owner] = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, OWNER.email));
    if (owner === undefined) throw new Error('owner not created');
    ownerId = owner.id;
  });

  afterAll(async () => {
    await resets.close();
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('asks nothing from the sign-in page any more, and keeps an unknown address out of the log', async () => {
    const page = await post(resets, '/v1/auth/password-reset', { email: OWNER.email });
    expect(page.statusCode).toBe(404);
    expect(await ask('nobody@example.test')).toEqual({ kind: 'unknown' });
    const unknown = await auditOf(null);
    expect(unknown.map((row) => row.details)).toEqual([{ outcome: 'unknown' }]);
    expect(JSON.stringify(unknown)).not.toContain('nobody@example.test');
  });

  it('keeps a creator or an operator who left out', async () => {
    const creator = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creator, nameKey: creator, displayName: 'Démo', timezone: 'Europe/Paris' });
    const creatorId = newId(UserIdSchema);
    await test.admin.db.insert(schema.user).values({
      id: creatorId,
      name: 'Créatrice',
      email: 'creator@example.test',
      role: 'creator',
      creatorIds: [creator],
    });
    const leftId = newId(UserIdSchema);
    await test.admin.db
      .insert(schema.user)
      .values({ id: leftId, name: 'Parti', email: 'left@example.test', role: 'operator' });
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId: leftId,
      teamRole: 'chatter',
      firstName: 'Parti',
      lastName: 'Inventé',
      displayName: 'Parti',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
      status: 'left',
      leftOn: '2026-11-01',
    });
    expect(await ask('creator@example.test')).toEqual({ kind: 'unknown' });
    expect(await ask('left@example.test')).toEqual({ kind: 'unknown' });
    expect(await test.admin.db.select().from(schema.passwordResetLinks)).toEqual([]);
  });

  it('makes an owner a link of 15 minutes once per 5 minutes, which sets the password and keeps the code', async () => {
    const cookie = await signIn(server, OWNER.email, OWNER.password);
    const before = Date.now();
    const made = await ask(' Owner@Example.test ');
    if (made.kind !== 'made') throw new Error('no link made');
    expect(made.minutes).toBe(15);
    expect(made.url).toContain('http://localhost:5173/mot-de-passe-oublie#t=');
    const token = tokenOf(made.url);
    const [stored] = await test.admin.db.select().from(schema.passwordResetLinks);
    expect(stored?.tokenHash).not.toContain(token);
    expect((stored?.expiresAt.getTime() ?? 0) - before).toBeGreaterThan(14.9 * 60_000);
    expect((stored?.expiresAt.getTime() ?? 0) - before).toBeLessThan(15.1 * 60_000);

    // Asked again within 5 minutes: nothing new.
    expect(await ask(OWNER.email)).toEqual({ kind: 'too_soon' });

    const preview = await post(resets, '/v1/auth/password-reset/inspect', { token });
    expect(preview.json()).toMatchObject({ email: OWNER.email });

    const weak = await post(resets, '/v1/auth/password-reset/redeem', { token, password: 'court' });
    expect(weak.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(weak.json()).error.code).toBe('password_invalid');
    const breached = await post(resets, '/v1/auth/password-reset/redeem', { token, password: BREACHED });
    expect(breached.statusCode).toBe(400);

    const redeemed = await post(resets, '/v1/auth/password-reset/redeem', { token, password: NEW_PASSWORD });
    expect(redeemed.statusCode).toBe(204);
    // Every session ends; the old password no longer opens; the code is still asked with the new one.
    const me = await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    const old = await post(server, '/v1/auth/sign-in/email', {
      email: OWNER.email,
      password: OWNER.password,
    });
    expect(old.statusCode).toBe(401);
    await signInWithoutCode(server, OWNER.email, NEW_PASSWORD);
    const fresh = await post(server, '/v1/auth/sign-in/email', {
      email: OWNER.email,
      password: NEW_PASSWORD,
    });
    expect(fresh.json()).toMatchObject({ twoFactorRedirect: true });
    const [account] = await test.admin.db
      .select({ enabled: schema.user.twoFactorEnabled })
      .from(schema.user)
      .where(eq(schema.user.id, ownerId));
    expect(account?.enabled).toBe(true);

    // Used: one answer for a replayed, an unknown or an expired link.
    const replayed = await post(resets, '/v1/auth/password-reset/redeem', { token, password: NEW_PASSWORD });
    expect(replayed.statusCode).toBe(404);
    expect(ErrorBodySchema.parse(replayed.json()).error.code).toBe('password_reset_link_not_found');

    // Past the 5 minutes, a new link; once expired it opens nothing.
    await test.admin.db
      .update(schema.passwordResetLinks)
      .set({ createdAt: sql`now() - interval '6 minutes'` })
      .where(eq(schema.passwordResetLinks.userId, ownerId));
    const again = await ask(OWNER.email);
    if (again.kind !== 'made') throw new Error('no second link');
    const later = tokenOf(again.url);
    await test.admin.db
      .update(schema.passwordResetLinks)
      .set({ createdAt: sql`now() - interval '20 minutes'`, expiresAt: sql`now() - interval '1 minute'` })
      .where(
        sql`${schema.passwordResetLinks.usedAt} is null and ${schema.passwordResetLinks.revokedAt} is null`,
      );
    const expired = await post(resets, '/v1/auth/password-reset/inspect', { token: later });
    expect(expired.statusCode).toBe(404);

    const actions = (await auditOf(ownerId)).map((row) => row.action);
    expect(actions).toContain('password_reset.request');
    expect(actions).toContain('password_reset.redeem');
    const written = JSON.stringify(await auditOf(ownerId));
    expect(written).not.toContain(token);
    // Nothing of a link in the logs.
    expect(logs.join('')).not.toContain(token);
    expect(logs.join('')).not.toContain(later);
  });
});
