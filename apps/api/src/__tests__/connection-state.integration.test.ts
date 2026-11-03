import { EVENT_PAYLOADS } from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createConnectionStatePublisher } from '../connection-state';
import { createLogger } from '../logger';
import { revealSalesFeed, type SalesFeedFetch } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, type FakeCrm } from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MINUTE = 60_000;

/**
 * `connection_state_changed` (Telegram P3-12): the outbox keeps the transitions only, whatever the number of checks
 * and processes; Reveal's register is down on a refused key at once, on silence after a quarter of an hour, and back
 * at the first answer. Everything is invented (ADR 0010).
 */
describe('connection_state_changed', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let offline = false;
  let now = new Date('2026-11-03T08:00:00.000Z');
  const sink = new LogSink();
  let jobLogger: ReturnType<typeof createLogger>;

  const events = async (service: string) =>
    (
      await test.admin.db
        .select({
          creatorId: schema.domainEvents.creatorId,
          payload: schema.domainEvents.payload,
          correlationId: schema.domainEvents.correlationId,
        })
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.type, 'connection_state_changed'))
        .orderBy(schema.domainEvents.createdAt)
    )
      .map((row) => ({ ...row, payload: EVENT_PAYLOADS.connection_state_changed.parse(row.payload) }))
      .filter((row) => row.payload.service === service);

  const read = async (at: Date) => {
    now = at;
    await app.modules.connectors.jobs.readSales(jobLogger, 'job:test', true);
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    const logger = createLogger(config, sink);
    jobLogger = logger;
    // A network that can be cut: the adapter reads a thrown fetch as `unreachable`.
    const fetchOrCut: SalesFeedFetch = (url, init) =>
      offline ? Promise.reject(new TypeError('fetch failed')) : crm.fetch(url, init);
    app = await createApp(config, logger, {
      salesFeeds: { reveal: revealSalesFeed(fetchOrCut, FAKE_CRM_BASE_URL) },
      connectorsClock: () => now,
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('keeps the transitions only, one per outage however many processes see it', async () => {
    const at = new Date('2026-11-03T07:00:00.000Z');
    const publish = createConnectionStatePublisher(test.admin.db, () => at);
    // Working with nothing published before: nothing to say.
    expect(await publish('xai', { state: 'back' }, 'test')).toBe(false);
    const raced = await Promise.all([
      publish('xai', { state: 'down', reason: 'refused' }, 'test'),
      publish('xai', { state: 'down', reason: 'refused' }, 'test'),
    ]);
    expect(raced.filter(Boolean)).toHaveLength(1);
    // Still down, for another reason: the alert already went.
    expect(await publish('xai', { state: 'down', reason: 'unreachable' }, 'test')).toBe(false);
    // Another service is its own.
    expect(await publish('mistral', { state: 'down', reason: 'low_credit' }, 'test')).toBe(true);
    expect(await publish('xai', { state: 'back' }, 'test')).toBe(true);
    expect(await publish('xai', { state: 'back' }, 'test')).toBe(false);

    expect(await events('xai')).toEqual([
      {
        creatorId: null,
        correlationId: 'test',
        payload: { service: 'xai', state: 'down', reason: 'refused', since: at.toISOString() },
      },
      {
        creatorId: null,
        correlationId: 'test',
        payload: { service: 'xai', state: 'back', since: at.toISOString() },
      },
    ]);
  });

  it('tells Reveal’s register down after a quarter of an hour of silence, and back at its first answer', async () => {
    const connected = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/key',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { key: FAKE_CRM_KEY },
    });
    expect(connected.statusCode).toBe(200);
    const start = new Date('2026-11-03T08:00:00.000Z');
    await read(start);

    offline = true;
    // Three reads, but not yet a quarter of an hour: one slow minute never rings.
    for (const minutes of [1, 2, 3]) await read(new Date(start.getTime() + minutes * MINUTE));
    expect(await events('reveal_crm')).toEqual([]);
    await read(new Date(start.getTime() + 16 * MINUTE));
    await read(new Date(start.getTime() + 17 * MINUTE));
    expect((await events('reveal_crm')).map((event) => event.payload)).toEqual([
      {
        service: 'reveal_crm',
        state: 'down',
        reason: 'unreachable',
        since: new Date(start.getTime() + 16 * MINUTE).toISOString(),
      },
    ]);

    offline = false;
    await read(new Date(start.getTime() + 18 * MINUTE));
    expect((await events('reveal_crm')).map((event) => event.payload.state)).toEqual(['down', 'back']);
  });

  it('tells a refused key down at once, once, and never the key', async () => {
    crm.revoke();
    await read(new Date('2026-11-03T09:00:00.000Z'));
    await read(new Date('2026-11-03T09:01:00.000Z'));
    const told = await events('reveal_crm');
    expect(told.map((event) => event.payload)).toEqual([
      expect.objectContaining({ state: 'down', reason: 'unreachable' }),
      expect.objectContaining({ state: 'back' }),
      { service: 'reveal_crm', state: 'down', reason: 'refused', since: '2026-11-03T09:00:00.000Z' },
    ]);
    expect(JSON.stringify(told)).not.toContain(FAKE_CRM_KEY);
  });
});
