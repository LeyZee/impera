import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import {
  activateSecondFactor,
  codeFor,
  cookiesOf,
  DASHBOARD_ORIGIN,
  signInWithoutCode,
} from './support/sign-in';
import { secretOf, totpCode } from './support/totp';

/** Invented accounts, each from its own address (the limits are per account and IP). */
const account = (name: string) => ({
  email: `${name}@example.test`,
  name,
  password: `${name} correct horse battery`,
});

type Json = Record<string, unknown>;
const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });
const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;
const SetupSchema = z.object({ totpURI: z.string(), backupCodes: z.array(z.string()).length(10) });
const SessionSchema = z.object({
  state: z.string(),
  firstSteps: z.object({ codesKept: z.boolean(), welcomed: z.boolean() }).optional(),
});

describe('the first steps of an account survive a reload (recette 27/11, A8)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let address = 10;

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
  const sessionOf = async (cookie: string) =>
    SessionSchema.parse(
      (await server.inject({ method: 'GET', url: '/v1/session', headers: { cookie } })).json(),
    );
  /** Ages every session of the account: opened, and confirmed, `minutes` ago. */
  const age = (userId: string, minutes: number) =>
    test.admin.db
      .update(schema.session)
      .set({
        createdAt: sql`now() - make_interval(mins => ${minutes})`,
        codeConfirmedAt: sql`${schema.session.codeConfirmedAt} - make_interval(mins => ${minutes})`,
      })
      .where(eq(schema.session.userId, userId));
  const stepsOf = async (userId: string) => {
    const [row] = await test.admin.db
      .select({ kept: schema.user.backupCodesKeptAt, welcomed: schema.user.welcomedAt })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    return row;
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
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

  it('gives the same key and the same codes until a first code confirms them', async () => {
    const ana = account('ana');
    const { userId } = await createOwner(app.auth, app.db.db, ana);
    const post = from();
    const cookie = await signInWithoutCode(server, ana.email, ana.password);

    // The session has just proven the password: the first step asks for nothing more.
    const first = await post('/v1/auth/two-factor/enable', {}, cookie);
    expect(first.statusCode).toBe(200);
    const setup = SetupSchema.parse(first.json());
    expect(setup.totpURI).toMatch(/^otpauth:\/\/totp\/Impera:ana%40example\.test\?secret=/);
    // A reload, with or without the password: the key already in the authenticator app is still the one.
    const again = await post('/v1/auth/two-factor/enable', {}, cookie);
    expect(SetupSchema.parse(again.json())).toEqual(setup);
    const withPassword = await post('/v1/auth/two-factor/enable', { password: ana.password }, cookie);
    expect(SetupSchema.parse(withPassword.json())).toEqual(setup);
    expect(
      await test.admin.db
        .select({ verified: schema.twoFactor.verified })
        .from(schema.twoFactor)
        .where(eq(schema.twoFactor.userId, userId)),
    ).toEqual([{ verified: false }]);

    // Proven too long ago: the password is asked again, a wrong one is refused, and the key stays the same.
    await age(userId, 11);
    const late = await post('/v1/auth/two-factor/enable', {}, cookie);
    expect([late.statusCode, codeOf(late)]).toEqual([403, 'password_missing_forbidden']);
    const wrong = await post('/v1/auth/two-factor/enable', { password: 'not the password' }, cookie);
    expect([wrong.statusCode, codeOf(wrong)]).toEqual([401, 'password_unauthenticated']);
    const proven = await post('/v1/auth/two-factor/enable', { password: ana.password }, cookie);
    expect(SetupSchema.parse(proven.json())).toEqual(setup);

    // The first code of that key activates the account, and the codes shown are its backup codes.
    const verified = await post(
      '/v1/auth/two-factor/verify-totp',
      { code: totpCode(secretOf(setup.totpURI)) },
      cookie,
    );
    expect(verified.statusCode).toBe(200);
    const session = cookiesOf(verified.headers);
    expect(await sessionOf(session)).toEqual({
      state: 'signed_in',
      firstSteps: { codesKept: false, welcomed: false },
    });
    const shown = await post('/v1/me/first-steps/backup-codes', {}, session);
    expect(shown.json()).toEqual({ backupCodes: setup.backupCodes });
    // Active: no key is given any more.
    expect(codeOf(await post('/v1/auth/two-factor/enable', {}, session))).toBe('second_factor_conflict');
  });

  it('keeps the codes and the welcome to show until each is said done, once', async () => {
    const bea = account('bea');
    const { userId } = await createOwner(app.auth, app.db.db, bea);
    const post = from();
    const pending = await signInWithoutCode(server, bea.email, bea.password);
    // Before the code is active, there is no first step to say done.
    const early = await post('/v1/me/first-steps/welcomed', {}, pending);
    expect([early.statusCode, codeOf(early)]).toEqual([403, 'second_factor_forbidden']);
    expect((await post('/v1/me/first-steps/welcomed', {}, '')).statusCode).toBe(401);
    expect((await post('/v1/me/first-steps/backup-codes', {}, '')).statusCode).toBe(401);

    const { cookie, backupCodes } = await activateSecondFactor(server, bea.email, bea.password, pending);
    expect((await sessionOf(cookie)).firstSteps).toEqual({ codesKept: false, welcomed: false });
    expect((await post('/v1/me/first-steps/anything-else', {}, cookie)).statusCode).toBe(400);

    // A reload on the codes: they are shown again, and the audit says so.
    expect((await post('/v1/me/first-steps/backup-codes', {}, cookie)).json()).toEqual({ backupCodes });
    expect(
      await test.admin.db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.action, 'auth.backup_codes_shown_again'),
            eq(schema.auditLog.userId, userId),
          ),
        ),
    ).toHaveLength(1);

    expect((await post('/v1/me/first-steps/codes-kept', {}, cookie)).statusCode).toBe(204);
    expect((await sessionOf(cookie)).firstSteps).toEqual({ codesKept: true, welcomed: false });
    // Said kept: never read again.
    const gone = await post('/v1/me/first-steps/backup-codes', {}, cookie);
    expect([gone.statusCode, codeOf(gone)]).toEqual([410, 'backup_codes_gone']);

    expect((await post('/v1/me/first-steps/welcomed', {}, cookie)).statusCode).toBe(204);
    expect((await sessionOf(cookie)).firstSteps).toEqual({ codesKept: true, welcomed: true });
    // The first time stays.
    const before = await stepsOf(userId);
    expect((await post('/v1/me/first-steps/welcomed', {}, cookie)).statusCode).toBe(204);
    expect((await post('/v1/me/first-steps/codes-kept', {}, cookie)).statusCode).toBe(204);
    expect(await stepsOf(userId)).toEqual(before);
  });

  it('shows the codes again only on the session that has just given the password and the code', async () => {
    const cleo = account('cleo');
    const { userId } = await createOwner(app.auth, app.db.db, cleo);
    const post = from();
    const pending = await signInWithoutCode(server, cleo.email, cleo.password);
    const { cookie } = await activateSecondFactor(server, cleo.email, cleo.password, pending);
    await age(userId, 11);
    const late = await post('/v1/me/first-steps/backup-codes', {}, cookie);
    expect([late.statusCode, codeOf(late)]).toEqual([410, 'backup_codes_gone']);
    // Still not said kept: Sécurité makes new ones, which says them kept.
    expect((await sessionOf(cookie)).firstSteps).toEqual({ codesKept: false, welcomed: false });
    const made = await post(
      '/v1/auth/two-factor/generate-backup-codes',
      { password: cleo.password, code: codeFor(cleo.email) },
      cookie,
    );
    expect(made.statusCode).toBe(200);
    expect((await sessionOf(cookie)).firstSteps).toEqual({ codesKept: true, welcomed: false });
  });
});
