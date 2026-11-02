import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';

import { NotificationPreferencesSchema, PushPublicKeySchema, PushTestResultSchema } from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'staple battery horse' };

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

/** A device as a browser holds it: its key pair and its shared secret, and the subscription it hands the page. */
function device(endpoint: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const shared = randomBytes(16);
  return {
    ecdh,
    shared,
    subscription: {
      endpoint,
      expirationTime: null,
      keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: shared.toString('base64url') },
    },
  };
}

/** What the device does on receipt (RFC 8291), written apart from the server's code. */
function open(body: Buffer, phone: ReturnType<typeof device>): unknown {
  const hmac = (key: Buffer, data: Buffer): Buffer => createHmac('sha256', key).update(data).digest();
  const expand = (salt: Buffer, ikm: Buffer, info: string | Buffer, length: number): Buffer =>
    hmac(hmac(salt, ikm), Buffer.concat([Buffer.from(info), Buffer.from([1])])).subarray(0, length);
  const salt = body.subarray(0, 16);
  const serverKey = body.subarray(21, 21 + body.readUInt8(20));
  const record = body.subarray(21 + serverKey.length);
  const ikm = expand(
    phone.shared,
    phone.ecdh.computeSecret(serverKey),
    Buffer.concat([Buffer.from('WebPush: info\0'), phone.ecdh.getPublicKey(), serverKey]),
    32,
  );
  const decipher = createDecipheriv(
    'aes-128-gcm',
    expand(salt, ikm, 'Content-Encoding: aes128gcm\0', 16),
    expand(salt, ikm, 'Content-Encoding: nonce\0', 12),
  );
  decipher.setAuthTag(record.subarray(-16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()]);
  return JSON.parse(padded.subarray(0, padded.lastIndexOf(2)).toString());
}

describe('push notifications (CR-01, /v1/notifications)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: Record<string, string>;
  let creator: Record<string, string>;
  let creatorId: string;
  const config = () =>
    testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${randomBytes(32).toString('base64')}`,
    });
  let configured: ReturnType<typeof config>;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    configured = config();
    app = await createApp(configured, createLogger(configured));
    server = await buildServer({
      config: configured,
      logger: createLogger(configured),
      routes: app.routes,
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    ({ userId: creatorId } = await createOwner(app.auth, app.db.db, CREATOR));
    await test.admin.db.update(schema.user).set({ role: 'creator' }).where(eq(schema.user.id, creatorId));
    owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    creator = { cookie: await signIn(server, CREATOR.email, CREATOR.password), origin: DASHBOARD_ORIGIN };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const call = (method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, headers?: object, payload?: object) =>
    server.inject({ method, url, headers: { ...headers }, ...(payload === undefined ? {} : { payload }) });

  it('makes one server key, sealed, kept across restarts, and out of the application role’s reach', async () => {
    expect((await call('GET', '/v1/notifications/push-key')).statusCode).toBe(401);
    const first = PushPublicKeySchema.parse((await call('GET', '/v1/notifications/push-key', owner)).json());
    const second = PushPublicKeySchema.parse(
      (await call('GET', '/v1/notifications/push-key', creator)).json(),
    );
    expect(second.publicKey).toBe(first.publicKey);

    const again = await createApp(configured, createLogger(configured));
    try {
      const rows = await test.admin.db.select().from(schema.pushServerKeys);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.privateKeyCiphertext.includes(rows[0].publicKey)).toBe(false);
      expect(again.modules.notifications.deliver).not.toBeNull();
    } finally {
      await again.shutdown();
    }
    // 42501: insufficient_privilege.
    await expect(app.db.db.execute(sql`select * from push_server_keys`)).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  it('records a device only for a known push service, and rings it, encrypted, with the server’s signature', async () => {
    const phone = device('https://fcm.googleapis.com/fcm/send/creator-phone');
    const refused = await call('PUT', '/v1/notifications/subscriptions', creator, {
      ...phone.subscription,
      endpoint: 'https://169.254.169.254/latest/meta-data',
    });
    expect(refused.statusCode).toBe(400);
    expect((await call('POST', '/v1/notifications/test', creator)).statusCode).toBe(404);

    expect(
      (await call('PUT', '/v1/notifications/subscriptions', creator, phone.subscription)).statusCode,
    ).toBe(204);
    // Each opening says it again: still one device.
    expect(
      (await call('PUT', '/v1/notifications/subscriptions', creator, phone.subscription)).statusCode,
    ).toBe(204);

    const sent: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: { headers: Record<string, string>; body: Buffer }) => {
        sent.push({ url, headers: init.headers, body: init.body });
        return Promise.resolve(new Response(null, { status: 201 }));
      }),
    );
    const result = await call('POST', '/v1/notifications/test', creator);
    expect(result.statusCode).toBe(200);
    expect(PushTestResultSchema.parse(result.json())).toEqual({ devices: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(phone.subscription.endpoint);
    expect(sent[0]?.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '86400' });
    expect(sent[0]?.headers['Authorization']).toMatch(/^vapid t=.+, k=.+$/u);
    expect(open(sent[0]?.body ?? Buffer.alloc(0), phone)).toMatchObject({
      title: 'Notifications activées',
      url: '/moi',
    });

    // The owner has no device: the creator's stays hers.
    expect((await call('POST', '/v1/notifications/test', owner)).statusCode).toBe(404);
  });

  it('moves a device to the account now signed in on it, and forgets a device its push service calls dead', async () => {
    const shared = device('https://web.push.apple.com/shared-phone');
    await call('PUT', '/v1/notifications/subscriptions', creator, shared.subscription);
    expect(
      (await call('PUT', '/v1/notifications/subscriptions', owner, shared.subscription)).statusCode,
    ).toBe(204);
    const rows = await test.admin.db
      .select({ userId: schema.pushSubscriptions.userId })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, shared.subscription.endpoint));
    expect(rows).toHaveLength(1);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 410 }))),
    );
    const result = PushTestResultSchema.parse((await call('POST', '/v1/notifications/test', owner)).json());
    expect(result).toEqual({ devices: 1, sent: 0 });
    expect((await call('POST', '/v1/notifications/test', owner)).statusCode).toBe(404);
  });

  it('forgets a device on request, never another account’s', async () => {
    const phone = device('https://updates.push.services.mozilla.com/wpush/v2/owner-laptop');
    await call('PUT', '/v1/notifications/subscriptions', owner, phone.subscription);
    const other = await call('DELETE', '/v1/notifications/subscriptions', creator, {
      endpoint: phone.subscription.endpoint,
    });
    expect(other.statusCode).toBe(204);
    const kept = await test.admin.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, phone.subscription.endpoint));
    expect(kept).toHaveLength(1);
    await call('DELETE', '/v1/notifications/subscriptions', owner, { endpoint: phone.subscription.endpoint });
    const gone = await test.admin.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, phone.subscription.endpoint));
    expect(gone).toHaveLength(0);
  });

  it('keeps each account’s quiet hours and cap, with the defaults until changed', async () => {
    const read = async (headers: object) =>
      NotificationPreferencesSchema.parse(
        (await call('GET', '/v1/notifications/preferences', headers)).json(),
      );
    expect(await read(creator)).toEqual({ quietHours: { startMinute: 1320, endMinute: 480 }, dailyCap: 6 });
    const late = { quietHours: { startMinute: 60, endMinute: 600 }, dailyCap: 3 };
    expect((await call('PUT', '/v1/notifications/preferences', creator, late)).statusCode).toBe(200);
    expect(await read(creator)).toEqual(late);
    expect(await read(owner)).toEqual({ quietHours: { startMinute: 1320, endMinute: 480 }, dailyCap: 6 });
    const wrong = await call('PUT', '/v1/notifications/preferences', creator, { ...late, dailyCap: 0 });
    expect(wrong.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(wrong.json()).error.code).toBe('request_invalid');
  });
});
