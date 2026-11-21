import { LinkServiceStatusSchema } from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { LinkServiceError, type LinkServiceReader } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const SERVICE_HOST = 'liens.example';
const GOOD_KEY = 'FAKE-link-service-key-accepted';
const BAD_KEY = 'FAKE-link-service-key-refused';
const URL_STATUS = '/v1/settings/link-service';
const URL_KEY = '/v1/settings/link-service/key';

/** A redirect service in memory that accepts one key. */
const readerOf = (key: string): LinkServiceReader => ({
  ping: () => (key === GOOD_KEY ? Promise.resolve() : Promise.reject(new LinkServiceError('unauthorized'))),
  listLinks: () => Promise.resolve([]),
});

/** The agency's key of the redirect service through the real app (INS-02, ADR 0120 § 3). */
describe('link service key (INS-02)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  const sink = new LogSink();

  const api = (method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: object, cookie = owner) =>
    server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });

  const rows = async () => (await test.admin.db.select().from(schema.linkServiceCredentials)).length;

  async function start(origin: string | undefined) {
    const config = testConfig({
      LOG_LEVEL: 'trace',
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
      ...(origin === undefined ? {} : { LINK_SERVICE_ORIGIN: origin }),
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger, { linkServiceReaderOf: readerOf });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
  }

  async function stop() {
    await server.close();
    await app.shutdown();
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await start(`https://${SERVICE_HOST}`);
    await createOwner(app.auth, app.db.db, OWNER);
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  afterAll(async () => {
    await stop();
    await test.close();
  });

  it('is the owner’s only', async () => {
    expect((await server.inject({ method: 'GET', url: URL_STATUS })).statusCode).toBe(401);
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    expect((await api('GET', URL_STATUS, undefined, operator)).statusCode).toBe(403);
    expect((await api('PUT', URL_KEY, { key: GOOD_KEY }, operator)).statusCode).toBe(403);
    expect((await api('DELETE', URL_STATUS, undefined, operator)).statusCode).toBe(403);
    expect(await rows()).toBe(0);
  });

  it('never keeps a key the service refuses', async () => {
    const refused = await api('PUT', URL_KEY, { key: BAD_KEY });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({
      error: { code: 'link_service_unprocessable', details: { kind: 'unauthorized' } },
    });
    expect(await rows()).toBe(0);
    expect(LinkServiceStatusSchema.parse((await api('GET', URL_STATUS)).json()).state).toBe('not_connected');
  });

  it('keeps an accepted key sealed, and no answer, log nor audit line carries it', async () => {
    const connected = await api('PUT', URL_KEY, { key: `  ${GOOD_KEY}\n` });
    expect(connected.statusCode).toBe(200);
    expect(LinkServiceStatusSchema.parse(connected.json()).state).toBe('connected');
    const status = await api('GET', URL_STATUS);
    expect(Object.keys(LinkServiceStatusSchema.parse(status.json())).sort()).toEqual([
      'connectedAt',
      'state',
    ]);

    // Replaced by the same gesture: still one row.
    expect((await api('PUT', URL_KEY, { key: GOOD_KEY })).statusCode).toBe(200);
    expect(await rows()).toBe(1);

    const audit = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'link_service_credential'));
    expect(audit.map((line) => line.action).sort()).toEqual([
      'link_service_key.connected',
      'link_service_key.replaced',
    ]);
    expect(audit.every((line) => line.userId !== null)).toBe(true);

    const stored = await test.admin.db.execute(
      sql`select encode(key_ciphertext, 'escape') as c from link_service_credentials`,
    );
    const everything = [
      connected.body,
      status.body,
      JSON.stringify(audit),
      JSON.stringify(stored.rows),
      JSON.stringify(sink.lines),
    ].join(' ');
    for (const secret of [GOOD_KEY, BAD_KEY, SERVICE_HOST]) expect(everything).not.toContain(secret);
  });

  it('removes the key on the owner’s gesture, with its line', async () => {
    const removed = await api('DELETE', URL_STATUS);
    expect(removed.statusCode).toBe(200);
    expect(LinkServiceStatusSchema.parse(removed.json())).toEqual({
      state: 'not_connected',
      connectedAt: null,
    });
    expect(await rows()).toBe(0);
    const [line] = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'link_service_key.disconnected'));
    expect(line?.action).toBe('link_service_key.disconnected');
  });

  it('is off, and keeps nothing, on a server without the address of the service', async () => {
    await stop();
    await start(undefined);
    owner = await signIn(server, OWNER.email, OWNER.password);
    expect(LinkServiceStatusSchema.parse((await api('GET', URL_STATUS)).json())).toEqual({
      state: 'off',
      connectedAt: null,
    });
    const refused = await api('PUT', URL_KEY, { key: GOOD_KEY });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { details: { kind: 'off' } } });
    expect(await rows()).toBe(0);
  });
});
