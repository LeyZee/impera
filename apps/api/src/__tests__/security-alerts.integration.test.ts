import { SecurityAlertPayloadSchema } from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { resetAccountSecondFactor } from '../ops';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { codeFor, cookiesOf, DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented accounts; each test uses its own, from its own address (the limits are per account and IP). */
const account = (name: string) => ({
  email: `${name}@example.test`,
  name,
  password: `${name} correct horse battery`,
});

type Json = Record<string, unknown>;

describe('security alerts (ADR 0046 § 8, SEC-04)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let address = 10;

  /** A request from an address of its own; returns the address with the poster. */
  const from = () => {
    address += 1;
    const remoteAddress = `203.0.113.${String(address)}`;
    const post = (url: string, payload: Json, cookie = '') =>
      server.inject({
        method: 'POST',
        url,
        payload,
        remoteAddress,
        headers: { origin: DASHBOARD_ORIGIN, ...(cookie === '' ? {} : { cookie }) },
      });
    return { post, remoteAddress };
  };

  /** The security alerts about one account, oldest first, read as the Telegram module reads them. */
  const alertsOf = async (userId: string) => {
    const rows = await test.admin.db
      .select({ creatorId: schema.domainEvents.creatorId, payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.type, 'security_alert'),
          sql`${schema.domainEvents.payload}->>'userId' = ${userId}`,
        ),
      )
      .orderBy(schema.domainEvents.createdAt);
    return rows.map((row) => ({
      creatorId: row.creatorId,
      ...SecurityAlertPayloadSchema.parse(row.payload),
    }));
  };
  const auditOf = async (userId: string, action: string) =>
    test.admin.db
      .select({ ip: schema.auditLog.ip })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, userId), eq(schema.auditLog.action, action)));

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

  it('tells a sign-in of the owner that a code was asked for, never one a trusted device spared', async () => {
    const olga = account('olga');
    const { userId } = await createOwner(app.auth, app.db.db, olga);
    // The first sign-in (no code set yet), then the one after the activation: two devices nothing vouched for.
    await signIn(server, olga.email, olga.password);
    expect((await alertsOf(userId)).map((alert) => alert.reason)).toEqual([
      'new_device_sign_in',
      'new_device_sign_in',
    ]);

    const { post, remoteAddress } = from();
    const pending = await post('/v1/auth/sign-in/email', { email: olga.email, password: olga.password });
    const trusted = await post(
      '/v1/auth/two-factor/verify-totp',
      { code: codeFor(olga.email), trustDevice: true },
      cookiesOf(pending.headers),
    );
    expect(trusted.statusCode).toBe(200);
    const alerts = await alertsOf(userId);
    expect(alerts).toHaveLength(3);
    // The network, never the address: no creator, the owner's role.
    expect(alerts[2]).toEqual({
      creatorId: null,
      reason: 'new_device_sign_in',
      userId,
      role: 'owner',
      network: '203.0.113.x',
    });
    expect(JSON.stringify(alerts)).not.toContain(remoteAddress);

    const device = cookiesOf(trusted.headers)
      .split('; ')
      .filter((pair) => pair.includes('trust_device'))
      .join('; ');
    const again = await post(
      '/v1/auth/sign-in/email',
      { email: olga.email, password: olga.password },
      device,
    );
    expect(again.json()).toMatchObject({ user: { email: olga.email } });
    expect(await alertsOf(userId)).toHaveLength(3);
  });

  it('never tells the sign-in of a member of the team', async () => {
    const theo = account('theo');
    const { userId } = await createOwner(app.auth, app.db.db, theo);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    await signIn(server, theo.email, theo.password);
    expect(await alertsOf(userId)).toEqual([]);
  });

  it('tells five refusals of a password or a code on one account in 15 minutes, once per window', async () => {
    const remi = account('remi');
    const { userId } = await createOwner(app.auth, app.db.db, remi);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    await signIn(server, remi.email, remi.password);
    const { post } = from();
    const wrongPassword = () => post('/v1/auth/sign-in/email', { email: remi.email, password: 'not it' });

    for (let i = 0; i < 3; i += 1) expect((await wrongPassword()).statusCode).toBe(401);
    // Two wrong codes at the code step of a right password: the same account, the same count.
    const pending = await post('/v1/auth/sign-in/email', { email: remi.email, password: remi.password });
    for (const code of ['000000', '111111']) {
      expect(
        (await post('/v1/auth/two-factor/verify-totp', { code }, cookiesOf(pending.headers))).statusCode,
      ).toBe(401);
    }
    expect(await auditOf(userId, 'auth.sign_in_refused')).toHaveLength(3);
    expect(await auditOf(userId, 'auth.code_refused')).toHaveLength(2);
    expect(await alertsOf(userId)).toEqual([
      {
        creatorId: null,
        reason: 'sign_in_refusals',
        userId,
        role: 'operator',
        network: '203.0.113.x',
        refusals: 5,
        windowMinutes: 15,
      },
    ]);

    // The attack goes on: nothing more within the window.
    expect((await wrongPassword()).statusCode).toBe(401);
    expect(await alertsOf(userId)).toHaveLength(1);
  });

  it('writes nothing for an e-mail that is nobody’s', async () => {
    const { post } = from();
    const before = await test.admin.db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLog);
    expect(
      (await post('/v1/auth/sign-in/email', { email: 'nobody@example.test', password: 'x' })).statusCode,
    ).toBe(401);
    const after = await test.admin.db.select({ n: sql<number>`count(*)::int` }).from(schema.auditLog);
    expect(after).toEqual(before);
  });

  it('tells a second factor reset from the server, only when there was one', async () => {
    const sam = account('sam');
    const { userId } = await createOwner(app.auth, app.db.db, sam);
    expect(await resetAccountSecondFactor(test.admin.db, sam.email)).toEqual({ hadSecondFactor: false });
    expect(await alertsOf(userId)).toEqual([]);

    await signIn(server, sam.email, sam.password);
    expect(await resetAccountSecondFactor(test.admin.db, sam.email)).toEqual({ hadSecondFactor: true });
    expect((await alertsOf(userId)).at(-1)).toEqual({
      creatorId: null,
      reason: 'second_factor_reset',
      userId,
      role: 'owner',
      network: null,
      via: 'ops',
    });
  });
});
