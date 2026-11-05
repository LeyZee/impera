import { AccountsSecuritySchema, BackupCodesSchema, OpenSessionsSchema } from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { codeFor, cookiesOf, DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented accounts and devices. */
const account = (name: string) => ({
  email: `${name}@example.test`,
  name,
  password: `${name} correct horse battery`,
});
const LAPTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

type Json = Record<string, unknown>;
const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });
const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;

describe('Réglages › Sécurité (ADR 0046 § 7, SEC-04)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let address = 10;

  const request = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    cookie: string,
    options: { payload?: Json; userAgent?: string; remoteAddress?: string } = {},
  ) =>
    server.inject({
      method,
      url,
      ...(options.payload === undefined ? {} : { payload: options.payload }),
      remoteAddress: options.remoteAddress ?? '192.0.2.1',
      headers: {
        origin: DASHBOARD_ORIGIN,
        'user-agent': options.userAgent ?? LAPTOP,
        ...(cookie === '' ? {} : { cookie }),
      },
    });

  /** A sign-in with the code from a device of its own (its browser and its address), its second factor active. */
  const signInFrom = async (email: string, password: string, userAgent: string, trustDevice = false) => {
    address += 1;
    const remoteAddress = `198.51.100.${String(address)}`;
    const pending = await request('POST', '/v1/auth/sign-in/email', '', {
      payload: { email, password },
      userAgent,
      remoteAddress,
    });
    const verified = await request('POST', '/v1/auth/two-factor/verify-totp', cookiesOf(pending.headers), {
      payload: { code: codeFor(email), trustDevice },
      userAgent,
      remoteAddress,
    });
    expect(verified.statusCode, verified.body).toBe(200);
    return cookiesOf(verified.headers);
  };
  const sessionsOf = async (cookie: string) =>
    OpenSessionsSchema.parse((await request('GET', '/v1/auth/sessions', cookie)).json()).sessions;
  const me = async (cookie: string) => (await request('GET', '/v1/me', cookie)).statusCode;
  const trustedDevicesOf = async (userId: string) =>
    test.admin.db
      .select({ id: schema.verification.id })
      .from(schema.verification)
      .where(
        and(
          eq(schema.verification.value, userId),
          sql`${schema.verification.identifier} like 'trust-device-%'`,
        ),
      );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), { passwordBreaches: () => Promise.resolve(false) });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('lists one’s own open sessions by device and network, and closes another one', async () => {
    const lina = account('lina');
    await createOwner(app.auth, app.db.db, lina);
    await signIn(server, lina.email, lina.password);
    const laptop = await signInFrom(lina.email, lina.password, LAPTOP);
    const phone = await signInFrom(lina.email, lina.password, PHONE);

    const sessions = await sessionsOf(laptop);
    const current = sessions.filter((session) => session.current);
    expect(current).toHaveLength(1);
    expect(current[0]?.device).toBe('Chrome sur Windows');
    expect(current[0]?.network).toMatch(/\.x$/u);
    const onPhone = sessions.find((session) => session.device === 'Safari sur iPhone');
    if (onPhone === undefined) throw new Error('the phone’s session expected');
    // Never the address itself, never a token.
    expect(JSON.stringify(sessions)).not.toMatch(/198\.51\.100\.\d+"|token/u);

    const closeCurrent = await request('DELETE', `/v1/auth/sessions/${current[0]?.id ?? ''}`, laptop);
    expect([closeCurrent.statusCode, codeOf(closeCurrent)]).toEqual([409, 'session_current_conflict']);
    expect((await request('DELETE', `/v1/auth/sessions/${onPhone.id}`, laptop)).statusCode).toBe(204);
    expect(await me(phone)).toBe(401);
    expect(await me(laptop)).toBe(200);
    const again = await request('DELETE', `/v1/auth/sessions/${onPhone.id}`, laptop);
    expect([again.statusCode, codeOf(again)]).toEqual([404, 'session_not_found']);

    // A session past its 7 days (ADR 0046 § 6) is refused at its next request: it is not listed either.
    const [old] = (await sessionsOf(laptop)).filter((session) => !session.current);
    if (old === undefined) throw new Error('the first sign-in’s session expected');
    await test.admin.db
      .update(schema.session)
      .set({ createdAt: sql`now() - interval '8 days'` })
      .where(eq(schema.session.id, old.id));
    expect((await sessionsOf(laptop)).map((session) => session.id)).not.toContain(old.id);
  });

  it('never closes someone else’s session', async () => {
    const [mia, noe] = [account('mia'), account('noe')];
    await createOwner(app.auth, app.db.db, mia);
    await createOwner(app.auth, app.db.db, noe);
    const miaCookie = await signIn(server, mia.email, mia.password);
    const noeCookie = await signIn(server, noe.email, noe.password);
    const [noeSession] = (await sessionsOf(noeCookie)).filter((session) => session.current);
    const refused = await request('DELETE', `/v1/auth/sessions/${noeSession?.id ?? ''}`, miaCookie);
    expect(refused.statusCode).toBe(404);
    expect(await me(noeCookie)).toBe(200);
  });

  it('closes every other session and forgets the trusted devices', async () => {
    const owen = account('owen');
    const { userId } = await createOwner(app.auth, app.db.db, owen);
    await signIn(server, owen.email, owen.password);
    const phone = await signInFrom(owen.email, owen.password, PHONE, true);
    const laptop = await signInFrom(owen.email, owen.password, LAPTOP);
    expect(await trustedDevicesOf(userId)).toHaveLength(1);

    const closed = await request('POST', '/v1/auth/sessions/close-others', laptop);
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ trustedDevices: 1 });
    expect(await me(phone)).toBe(401);
    expect(await me(laptop)).toBe(200);
    expect((await sessionsOf(laptop)).map((session) => session.current)).toEqual([true]);
    expect(await trustedDevicesOf(userId)).toEqual([]);
  });

  it('keeps the trusted device of the browser that closes the others (recette 05/11, reco 24)', async () => {
    const tess = account('tess');
    const { userId } = await createOwner(app.auth, app.db.db, tess);
    await signIn(server, tess.email, tess.password);
    await signInFrom(tess.email, tess.password, PHONE, true);
    const [phoneDevice] = await trustedDevicesOf(userId);
    const laptop = await signInFrom(tess.email, tess.password, LAPTOP, true);
    const devices = await trustedDevicesOf(userId);
    expect(devices).toHaveLength(2);
    const kept = devices.find((device) => device.id !== phoneDevice?.id);

    const closed = await request('POST', '/v1/auth/sessions/close-others', laptop);
    expect(closed.json()).toMatchObject({ trustedDevices: 1 });
    expect(await trustedDevicesOf(userId)).toEqual([kept]);
  });

  it('gives ten new backup codes against the password and a code; the old ones stop working', async () => {
    const pia = account('pia');
    const { userId } = await createOwner(app.auth, app.db.db, pia);
    const cookie = await signIn(server, pia.email, pia.password);
    const generate = (payload: Json) =>
      request('POST', '/v1/auth/two-factor/generate-backup-codes', cookie, { payload });

    const wrong = await generate({ password: pia.password, code: '000000' });
    expect([wrong.statusCode, codeOf(wrong)]).toEqual([401, 'reauthentication_unauthenticated']);
    const refusals = await test.admin.db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.userId, userId), eq(schema.auditLog.action, 'auth.reauthentication_refused')),
      );
    expect(refusals).toHaveLength(1);

    const first = BackupCodesSchema.parse(
      (await generate({ password: pia.password, code: codeFor(pia.email) })).json(),
    );
    const second = BackupCodesSchema.parse(
      (await generate({ password: pia.password, code: codeFor(pia.email, 1) })).json(),
    );
    expect(second.backupCodes).not.toEqual(first.backupCodes);

    // At sign-in, a code of the first batch no longer opens anything; one of the second does.
    const backupSignIn = async (code: string) => {
      const pending = await request('POST', '/v1/auth/sign-in/email', '', {
        payload: { email: pia.email, password: pia.password },
      });
      return request('POST', '/v1/auth/two-factor/verify-backup-code', cookiesOf(pending.headers), {
        payload: { code },
      });
    };
    expect((await backupSignIn(first.backupCodes[0] ?? '')).statusCode).toBe(401);
    expect((await backupSignIn(second.backupCodes[0] ?? '')).statusCode).toBe(200);
  });

  it('shows the owner each account’s second factor and sessions, and closes all of one account', async () => {
    const [quinn, rosa] = [account('quinn'), account('rosa')];
    const { userId: quinnId } = await createOwner(app.auth, app.db.db, quinn);
    const { userId: rosaId } = await createOwner(app.auth, app.db.db, rosa);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, rosaId));
    const owner = await signIn(server, quinn.email, quinn.password);
    const operator = await signIn(server, rosa.email, rosa.password);

    expect((await request('GET', '/v1/settings/security/accounts', operator)).statusCode).toBe(403);
    const listed = AccountsSecuritySchema.parse(
      (await request('GET', '/v1/settings/security/accounts', owner)).json(),
    ).accounts;
    expect(listed.find((row) => row.userId === rosaId)).toMatchObject({
      name: 'rosa',
      role: 'operator',
      secondFactor: true,
      // The session the activation left, and the sign-in's.
      sessions: 2,
    });
    // A device, a network: never shown to the owner.
    expect(JSON.stringify(listed)).not.toMatch(/device|network|Chrome/u);

    const closed = await request('POST', `/v1/settings/security/accounts/${rosaId}/close-sessions`, owner);
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({ sessions: 2 });
    expect(await me(operator)).toBe(401);
    const unknown = await request('POST', '/v1/settings/security/accounts/nobody/close-sessions', owner);
    expect([unknown.statusCode, codeOf(unknown)]).toEqual([404, 'account_not_found']);
    // His own account would sign him out: he closes his other sessions above instead.
    const own = await request('POST', `/v1/settings/security/accounts/${quinnId}/close-sessions`, owner);
    expect([own.statusCode, codeOf(own)]).toEqual([409, 'account_current_conflict']);
    expect(await me(owner)).toBe(200);

    // A sensitive action: a confirmation older than 10 minutes is asked again.
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });
    const stale = await request('POST', `/v1/settings/security/accounts/${rosaId}/close-sessions`, owner);
    expect([stale.statusCode, codeOf(stale)]).toEqual([403, 'reauthentication_forbidden']);
  });
});
