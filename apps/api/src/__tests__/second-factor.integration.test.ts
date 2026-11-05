import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { resetAccountSecondFactor, revokeDashboardSessions } from '../ops';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import {
  activateSecondFactor,
  codeFor,
  cookiesOf,
  DASHBOARD_ORIGIN,
  signIn,
  signInWithoutCode,
} from './support/sign-in';

/** Invented accounts; each test that counts tries uses its own, from its own address (the limits are per account and IP). */
const account = (name: string) => ({
  email: `${name}@example.test`,
  name,
  password: `${name} correct horse battery`,
});

type Json = Record<string, unknown>;
const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });
const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;

describe('second factor for every account (ADR 0046, SEC-02)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let address = 10;

  /** A request from an address of its own, so that one test's tries never spend another's per-IP budget. */
  const from = () => {
    address += 1;
    const remoteAddress = `198.51.100.${String(address)}`;
    return (url: string, payload: Json, cookie = '') =>
      server.inject({
        method: 'POST',
        url,
        payload,
        remoteAddress,
        headers: { origin: DASHBOARD_ORIGIN, ...(cookie === '' ? {} : { cookie }) },
      });
  };
  const get = (url: string, cookie: string) => server.inject({ method: 'GET', url, headers: { cookie } });
  const removeKey = (cookie: string) =>
    server.inject({
      method: 'DELETE',
      url: '/v1/settings/providers/xai',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
  const sessionsOf = async (email: string) =>
    test.admin.db
      .select({ reauthenticatedAt: schema.session.reauthenticatedAt })
      .from(schema.session)
      .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
      .where(eq(schema.user.email, email));
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

  it('opens nothing but the activation to an account without a code, and keeps its secret encrypted', async () => {
    const ana = account('ana');
    const { userId } = await createOwner(app.auth, app.db.db, ana);
    const post = from();
    const cookie = await signInWithoutCode(server, ana.email, ana.password);

    for (const response of [await get('/v1/me', cookie), await get('/v1/settings/providers', cookie)]) {
      expect(response.statusCode).toBe(403);
      expect(codeOf(response)).toBe('second_factor_forbidden');
    }
    // Anonymous, the activation answers 401 before reading its body (recette SEC-17).
    const anonymous = await post('/v1/auth/two-factor/enable', {}, '');
    expect([anonymous.statusCode, codeOf(anonymous)]).toEqual([401, 'session_unauthenticated']);
    const wrongPassword = await post('/v1/auth/two-factor/enable', { password: 'not the password' }, cookie);
    expect(wrongPassword.statusCode).toBe(401);
    expect(codeOf(wrongPassword)).toBe('password_unauthenticated');

    const enabled = await post('/v1/auth/two-factor/enable', { password: ana.password }, cookie);
    expect(enabled.statusCode).toBe(200);
    const setup = enabled.json<{ totpURI: string; backupCodes: string[] }>();
    expect(setup.totpURI).toMatch(/^otpauth:\/\/totp\/Impera:ana%40example\.test\?secret=/);
    expect(setup.backupCodes).toHaveLength(10);
    // Encrypted with the Better Auth secret: neither the secret nor a backup code is stored in clear.
    const [row] = await test.admin.db
      .select()
      .from(schema.twoFactor)
      .where(eq(schema.twoFactor.userId, userId));
    const secret = new URL(setup.totpURI).searchParams.get('secret') ?? '';
    expect(row?.secret).not.toContain(secret);
    for (const code of setup.backupCodes) expect(row?.backupCodes).not.toContain(code);
    expect(row?.verified).toBe(false);

    const wrongCode = await post('/v1/auth/two-factor/verify-totp', { code: '000000' }, cookie);
    expect(wrongCode.statusCode).toBe(401);
    expect(codeOf(wrongCode)).toBe('second_factor_unauthenticated');
    // Still nothing but the activation.
    expect(codeOf(await get('/v1/me', cookie))).toBe('second_factor_forbidden');
  });

  it('activates with a first code, then asks for a code at every sign-in', async () => {
    const bea = account('bea');
    await createOwner(app.auth, app.db.db, bea);
    const post = from();
    const first = await signInWithoutCode(server, bea.email, bea.password);
    const { cookie } = await activateSecondFactor(server, bea.email, bea.password, first);
    expect((await get('/v1/me', cookie)).statusCode).toBe(200);
    // The activation asked for the password and a code: a sensitive action right after passes.
    expect((await removeKey(cookie)).statusCode).toBe(200);
    // Active: no second secret, and no code checked on the session without the password.
    expect(codeOf(await post('/v1/auth/two-factor/enable', { password: bea.password }, cookie))).toBe(
      'second_factor_conflict',
    );
    expect(codeOf(await post('/v1/auth/two-factor/verify-totp', { code: codeFor(bea.email) }, cookie))).toBe(
      'second_factor_conflict',
    );

    const password = await post('/v1/auth/sign-in/email', { email: bea.email, password: bea.password });
    expect(password.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
    const pending = cookiesOf(password.headers);
    expect(pending).not.toMatch(/session_token/);
    expect((await get('/v1/me', pending)).statusCode).toBe(401);

    const wrong = await post('/v1/auth/two-factor/verify-totp', { code: '000000' }, pending);
    expect(codeOf(wrong)).toBe('second_factor_unauthenticated');
    const right = await post('/v1/auth/two-factor/verify-totp', { code: codeFor(bea.email) }, pending);
    expect(right.statusCode).toBe(200);
    const session = cookiesOf(right.headers);
    expect((await get('/v1/me', session)).statusCode).toBe(200);
    // The password and the code were both given: a sensitive action passes at once.
    expect((await removeKey(session)).statusCode).toBe(200);
    // The code step is used up with its session.
    expect(codeOf(await post('/v1/auth/two-factor/verify-totp', { code: codeFor(bea.email) }, pending))).toBe(
      'second_factor_challenge_unauthenticated',
    );
  });

  it('takes each backup code once', async () => {
    const cleo = account('cleo');
    await createOwner(app.auth, app.db.db, cleo);
    const post = from();
    const first = await signInWithoutCode(server, cleo.email, cleo.password);
    const { backupCodes } = await activateSecondFactor(server, cleo.email, cleo.password, first);
    const backup = backupCodes[0] ?? '';

    const signInWith = async (code: string) => {
      const pending = cookiesOf(
        (await post('/v1/auth/sign-in/email', { email: cleo.email, password: cleo.password })).headers,
      );
      return post('/v1/auth/two-factor/verify-backup-code', { code }, pending);
    };
    const used = await signInWith(backup);
    expect(used.statusCode).toBe(200);
    expect((await get('/v1/me', cookiesOf(used.headers))).statusCode).toBe(200);
    expect(codeOf(await signInWith(backup))).toBe('second_factor_unauthenticated');
  });

  it('skips the code on a trusted device, never before a sensitive action', async () => {
    const dina = account('dina');
    const { userId } = await createOwner(app.auth, app.db.db, dina);
    const post = from();
    await signIn(server, dina.email, dina.password);

    const pending = await post('/v1/auth/sign-in/email', { email: dina.email, password: dina.password });
    const trusted = await post(
      '/v1/auth/two-factor/verify-totp',
      { code: codeFor(dina.email), trustDevice: true },
      cookiesOf(pending.headers),
    );
    const device = cookiesOf(trusted.headers)
      .split('; ')
      .filter((pair) => pair.includes('trust_device'))
      .join('; ');
    expect(device).not.toBe('');
    expect(await trustedDevicesOf(userId)).toHaveLength(1);

    // From that device, the password alone opens a session, which has given no code.
    const again = await post(
      '/v1/auth/sign-in/email',
      { email: dina.email, password: dina.password },
      device,
    );
    expect(again.json()).toMatchObject({ user: { email: dina.email } });
    const session = cookiesOf(again.headers);
    const refused = await removeKey(session);
    expect(refused.statusCode).toBe(403);
    expect(codeOf(refused)).toBe('reauthentication_forbidden');

    // The confirmation: a wrong code or a wrong password, one answer; then both right.
    const confirm = (payload: Json) => post('/v1/auth/reauthenticate', payload, session);
    for (const wrong of [
      { password: dina.password, code: '000000' },
      { password: 'not the password', code: codeFor(dina.email) },
    ]) {
      const response = await confirm(wrong);
      expect(response.statusCode).toBe(401);
      expect(codeOf(response)).toBe('reauthentication_unauthenticated');
    }
    expect((await confirm({ password: dina.password, code: codeFor(dina.email) })).statusCode).toBe(204);
    expect((await removeKey(session)).statusCode).toBe(200);

    // Ten minutes later, asked again.
    await test.admin.db
      .update(schema.session)
      .set({ reauthenticatedAt: sql`now() - interval '11 minutes'` })
      .where(eq(schema.session.userId, userId));
    expect(codeOf(await removeKey(session))).toBe('reauthentication_forbidden');
  });

  it('confirms with a backup code too, and never spends one on a wrong password', async () => {
    const ella = account('ella');
    await createOwner(app.auth, app.db.db, ella);
    const post = from();
    const first = await signInWithoutCode(server, ella.email, ella.password);
    const { backupCodes } = await activateSecondFactor(server, ella.email, ella.password, first);
    const session = await signIn(server, ella.email, ella.password);
    const backup = backupCodes[1] ?? '';

    const wrongPassword = await post(
      '/v1/auth/reauthenticate',
      { password: 'nope nope nope', code: backup },
      session,
    );
    expect(codeOf(wrongPassword)).toBe('reauthentication_unauthenticated');
    expect(
      (await post('/v1/auth/reauthenticate', { password: ella.password, code: backup }, session)).statusCode,
    ).toBe(204);
    expect(
      codeOf(await post('/v1/auth/reauthenticate', { password: ella.password, code: backup }, session)),
    ).toBe('reauthentication_unauthenticated');
  });

  it('locks the code after ten wrong ones in a row, whatever the sign-in', async () => {
    const fred = account('fred');
    await createOwner(app.auth, app.db.db, fred);
    await signIn(server, fred.email, fred.password);

    const wrongCodes = async (post: ReturnType<typeof from>, count: number) => {
      const pending = cookiesOf(
        (await post('/v1/auth/sign-in/email', { email: fred.email, password: fred.password })).headers,
      );
      const answers: string[] = [];
      for (let i = 0; i < count; i += 1) {
        answers.push(codeOf(await post('/v1/auth/two-factor/verify-totp', { code: '000000' }, pending)));
      }
      return { pending, answers };
    };
    // Five tries per sign-in, then that sign-in starts over. Each round from its own address: the plugin's lock counts
    // for the account wherever the codes come from, under the limit per account and address (SEC-03).
    const firstRound = await wrongCodes(from(), 6);
    expect(firstRound.answers.slice(0, 5)).toEqual(Array(5).fill('second_factor_unauthenticated'));
    expect(firstRound.answers[5]).toBe('second_factor_challenge_unauthenticated');
    const secondRound = await wrongCodes(from(), 5);
    expect(secondRound.answers).toEqual(Array(5).fill('second_factor_unauthenticated'));
    // Ten in a row: even the right code waits 15 minutes.
    const post = from();
    const third = cookiesOf(
      (await post('/v1/auth/sign-in/email', { email: fred.email, password: fred.password })).headers,
    );
    const locked = await post('/v1/auth/two-factor/verify-totp', { code: codeFor(fred.email) }, third);
    expect(locked.statusCode).toBe(429);
    expect(codeOf(locked)).toBe('second_factor_limited');
  });

  it('limits the codes of an account from one address, not from another (ADR 0046 § 5)', async () => {
    const iris = account('iris');
    await createOwner(app.auth, app.db.db, iris);
    await signIn(server, iris.email, iris.password);
    const here = from();
    // Ten codes from one address, each sign-in ended by the right one so that the plugin's lock never counts.
    for (let round = 0; round < 2; round += 1) {
      const pending = cookiesOf(
        (await here('/v1/auth/sign-in/email', { email: iris.email, password: iris.password })).headers,
      );
      for (let i = 0; i < 4; i += 1) {
        expect(codeOf(await here('/v1/auth/two-factor/verify-totp', { code: '000000' }, pending))).toBe(
          'second_factor_unauthenticated',
        );
      }
      expect(
        (await here('/v1/auth/two-factor/verify-totp', { code: codeFor(iris.email) }, pending)).statusCode,
      ).toBe(200);
    }
    const pending = cookiesOf(
      (await here('/v1/auth/sign-in/email', { email: iris.email, password: iris.password })).headers,
    );
    const limited = await here('/v1/auth/two-factor/verify-totp', { code: codeFor(iris.email) }, pending);
    expect(limited.statusCode).toBe(429);
    expect(codeOf(limited)).toBe('second_factor_limited');

    const elsewhere = from();
    const fresh = cookiesOf(
      (await elsewhere('/v1/auth/sign-in/email', { email: iris.email, password: iris.password })).headers,
    );
    expect(
      (await elsewhere('/v1/auth/two-factor/verify-totp', { code: codeFor(iris.email) }, fresh)).statusCode,
    ).toBe(200);
  });

  it('writes a login only for a session that opened', async () => {
    const gus = account('gus');
    const { userId } = await createOwner(app.auth, app.db.db, gus);
    await signIn(server, gus.email, gus.password);
    const logins = async () =>
      (
        await test.admin.db
          .select({ id: schema.auditLog.id })
          .from(schema.auditLog)
          .where(and(eq(schema.auditLog.userId, userId), eq(schema.auditLog.action, 'auth.login')))
      ).length;
    const before = await logins();
    const post = from();
    const pending = await post('/v1/auth/sign-in/email', { email: gus.email, password: gus.password });
    expect(await logins()).toBe(before);
    await post('/v1/auth/two-factor/verify-totp', { code: codeFor(gus.email) }, cookiesOf(pending.headers));
    expect(await logins()).toBe(before + 1);
  });

  it('forgets the trusted devices with the sessions, and resets the code from the server', async () => {
    const hugo = account('hugo');
    const { userId } = await createOwner(app.auth, app.db.db, hugo);
    const post = from();
    await signIn(server, hugo.email, hugo.password);
    const trustDevice = async () => {
      const pending = await post('/v1/auth/sign-in/email', { email: hugo.email, password: hugo.password });
      await post(
        '/v1/auth/two-factor/verify-totp',
        { code: codeFor(hugo.email), trustDevice: true },
        cookiesOf(pending.headers),
      );
    };

    await trustDevice();
    expect(await trustedDevicesOf(userId)).toHaveLength(1);
    expect(await revokeDashboardSessions(test.admin.db, hugo.email)).toBeGreaterThan(0);
    expect(await sessionsOf(hugo.email)).toEqual([]);
    expect(await trustedDevicesOf(userId)).toEqual([]);

    await trustDevice();
    expect(await resetAccountSecondFactor(test.admin.db, hugo.email)).toEqual({ hadSecondFactor: true });
    expect(await sessionsOf(hugo.email)).toEqual([]);
    expect(await trustedDevicesOf(userId)).toEqual([]);
    expect(
      await test.admin.db.select().from(schema.twoFactor).where(eq(schema.twoFactor.userId, userId)),
    ).toEqual([]);
    const [audit] = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.entityId, userId), eq(schema.auditLog.action, 'auth.second_factor_reset')),
      );
    expect(audit?.details).toMatchObject({ via: 'ops', hadSecondFactor: true });
    // The password alone again, straight onto the activation.
    const cookie = await signInWithoutCode(server, hugo.email, hugo.password);
    expect(codeOf(await get('/v1/me', cookie))).toBe('second_factor_forbidden');
    await expect(resetAccountSecondFactor(test.admin.db, 'nobody@example.test')).rejects.toThrow(
      /Aucun compte/,
    );
  });
});
