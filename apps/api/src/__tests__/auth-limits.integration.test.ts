import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, codeFor, cookiesOf, signIn as signInWithCode } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };

describe('client IP and sign-in limits (G6)', () => {
  let test: TestDb;
  let app: App;
  let direct: Server;
  let proxied: Server;

  const signIn = (
    server: Server,
    email: string,
    password: string,
    from: { remoteAddress: string; headers?: Record<string, string> },
  ) =>
    server.inject({
      method: 'POST',
      url: '/v1/auth/sign-in/email',
      payload: { email, password },
      remoteAddress: from.remoteAddress,
      headers: { origin: DASHBOARD_ORIGIN, ...from.headers },
    });

  const lastLoginIp = async () => {
    const [row] = await test.admin.db
      .select({ ip: schema.auditLog.ip })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'auth.login'))
      .orderBy(sql`${schema.auditLog.createdAt} desc`)
      .limit(1);
    return row?.ip;
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    const server = (hops: string) => {
      const withHops = testConfig({
        DATABASE_URL: test.appUrl,
        DATABASE_SERVICE_URL: test.serviceUrl,
        TRUST_PROXY_HOPS: hops,
      });
      return buildServer({
        config: withHops,
        logger: createLogger(withHops),
        routes: app.routes,
        readiness: app.readiness,
        // The counters of production: a good sign-in forgets its tries there (recette SEC-11).
        rateLimitStore: app.rateLimitStore,
      });
    };
    direct = await server('0');
    proxied = await server('1');
    await createOwner(app.auth, app.db.db, OWNER);
  });

  afterAll(async () => {
    await direct.close();
    await proxied.close();
    await app.shutdown();
    await test.close();
  });

  it('records the client behind the proxy, never a header the client wrote', async () => {
    const response = await signIn(proxied, OWNER.email, OWNER.password, {
      remoteAddress: '10.0.0.2',
      headers: { 'x-forwarded-for': '203.0.113.7', 'x-impera-client-ip': '198.51.100.1' },
    });
    expect(response.statusCode).toBe(200);
    expect(await lastLoginIp()).toBe('203.0.113.7');
  });

  it('ignores x-forwarded-for when no proxy is declared', async () => {
    const response = await signIn(direct, OWNER.email, OWNER.password, {
      remoteAddress: '192.0.2.10',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(response.statusCode).toBe(200);
    expect(await lastLoginIp()).toBe('192.0.2.10');
  });

  it('limits an account from one address without locking its holder out elsewhere (ADR 0046 § 5)', async () => {
    const target = 'target@example.test';
    for (let i = 0; i < 10; i += 1) {
      const response = await signIn(direct, target, 'wrong password!', { remoteAddress: '192.0.2.20' });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await signIn(direct, target.toUpperCase(), 'wrong password!', {
      remoteAddress: '192.0.2.20',
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('sign_in_limited');

    // The same account from another address, and another account from the same one, are not held back.
    expect(
      (await signIn(direct, target, 'wrong password!', { remoteAddress: '192.0.2.21' })).statusCode,
    ).toBe(401);
    expect(
      (await signIn(direct, 'other@example.test', 'wrong password!', { remoteAddress: '192.0.2.20' }))
        .statusCode,
    ).toBe(401);
  });

  it('counts only refusals: good sign-ins never lock an account, wrong passwords still do (recette SEC-11)', async () => {
    const busy = { email: 'busy@example.test', name: 'Busy', password: 'busy correct horse battery' };
    await createOwner(app.auth, app.db.db, busy);
    const from = { remoteAddress: '192.0.2.40' };
    // Phone, computer, extension: twelve sign-ins in a quarter of an hour, more than the ten tries of one address.
    for (let i = 0; i < 12; i += 1) {
      expect((await signIn(direct, busy.email, busy.password, from)).statusCode).toBe(200);
    }
    // A sign-in that succeeds after refusals gives them back too.
    for (let i = 0; i < 9; i += 1) {
      expect((await signIn(direct, busy.email, 'wrong password!', from)).statusCode).toBe(401);
    }
    expect((await signIn(direct, busy.email, busy.password, from)).statusCode).toBe(200);
    for (let i = 0; i < 10; i += 1) {
      expect((await signIn(direct, busy.email, 'wrong password!', from)).statusCode).toBe(401);
    }
    const blocked = await signIn(direct, busy.email, busy.password, from);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('sign_in_limited');
  }, 60_000);

  it('caps an account at 100 tries from all addresses, a trusted device aside', async () => {
    const holder = { email: 'holder@example.test', name: 'Holder', password: 'holder correct horse battery' };
    await createOwner(app.auth, app.db.db, holder);
    // The holder trusts this browser: password, then the code with « se souvenir de cet appareil ».
    const session = await signInWithCode(direct, holder.email, holder.password);
    const pending = await signIn(direct, holder.email, holder.password, { remoteAddress: '192.0.2.30' });
    const trusted = await direct.inject({
      method: 'POST',
      url: '/v1/auth/two-factor/verify-totp',
      payload: { code: codeFor(holder.email), trustDevice: true },
      remoteAddress: '192.0.2.30',
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookiesOf(pending.headers) },
    });
    expect(trusted.statusCode).toBe(200);
    const trustCookie = cookiesOf(trusted.headers)
      .split('; ')
      .filter((pair) => pair.includes('trust_device'))
      .join('; ');
    expect(trustCookie).not.toBe('');
    expect(session).not.toBe('');

    // Someone else spreads guesses over many addresses, each under its own limit: with the holder's three sign-ins
    // above, the account reaches its 100. A good sign-in never gives back the tries of the cap (recette SEC-11).
    for (let i = 0; i < 97; i += 1) {
      const from = { remoteAddress: `198.51.${String(100 + Math.floor(i / 9))}.${String(i % 9)}` };
      expect((await signIn(direct, holder.email, 'wrong password!', from)).statusCode).toBe(401);
    }
    const capped = await signIn(direct, holder.email, holder.password, { remoteAddress: '203.0.113.50' });
    expect(capped.statusCode).toBe(429);
    expect(capped.json<{ error: { code: string } }>().error.code).toBe('sign_in_limited');

    // The holder's trusted browser still signs in, without a code.
    const fromTrusted = await signIn(direct, holder.email, holder.password, {
      remoteAddress: '192.0.2.31',
      headers: { cookie: trustCookie },
    });
    expect(fromTrusted.statusCode).toBe(200);
    expect(fromTrusted.json()).toMatchObject({ user: { email: holder.email } });
    // A hundred hashed passwords: 15 s alone, more under a loaded full suite (recette MOT-11).
  }, 90_000);
});
