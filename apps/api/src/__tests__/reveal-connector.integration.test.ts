import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealApiConnectors, type RevealFetch } from '../modules/connectors';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';
import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;

/**
 * P2-02: the poller reads Reveal through `RevealApiConnector`, pointed at FakeReveal's default world (invented: 12
 * fans, one conversation of 320 messages). The session goes the way the extension's « Sync » sends it: encrypted in
 * the account, opened by the resolver, read by the adapter.
 */
describe('Reveal connector: a poll on FakeReveal (P2-02)', () => {
  let test: TestDb;
  let app: App;
  let fake: FakeReveal;
  let creatorId: CreatorId;
  let logger: ReturnType<typeof createLogger>;
  let accountId: PlatformAccountId;
  const sink = new LogSink();
  /** Every call that reached FakeReveal, by path. */
  const calls: string[] = [];

  async function messages(): Promise<number> {
    const result = await test.admin.db.execute(
      sql`select count(*)::int as n, count(distinct platform_message_id)::int as d from messages where platform_account_id = ${accountId}`,
    );
    const [row] = z.array(z.object({ n: z.number(), d: z.number() })).parse(result.rows);
    // Each platform message once: no duplicate, ever.
    expect(row?.d).toBe(row?.n);
    return row?.n ?? 0;
  }

  async function sessionState(): Promise<string> {
    const [row] = await test.admin.db
      .select({ state: schema.platformAccounts.sessionState })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.id, accountId));
    return row?.state ?? 'missing';
  }

  async function scenario(events: object[]): Promise<void> {
    const response = await fake.app.inject({ method: 'POST', url: '/__scenario', payload: { events } });
    expect(response.statusCode).toBe(200);
  }

  const poll = () =>
    app.modules.connectors.jobs.poll(
      { creatorId, platformAccountId: accountId, correlationId: 'test' },
      logger,
    );

  beforeAll(async () => {
    fake = createFakeReveal();
    const fetch: RevealFetch = (url, init) => {
      calls.push(new URL(url).pathname);
      return fake.fetch(url, init);
    };
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      LOG_LEVEL: 'trace',
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    logger = createLogger(config, sink);
    const now = new Date(fake.state().now);
    app = await createApp(config, logger, {
      composer: fixedComposer,
      connectorsClock: () => now,
      connectorRegistry: {
        reveal: revealApiConnectors({
          fetch,
          baseUrl: 'https://reveal.test',
          // As the composition root logs each call (`wiring/connectors.ts`).
          log: (platformAccountId, entry) => {
            logger.debug({ platformAccountId, ...entry }, 'reveal: call');
          },
        }),
      },
    });
    creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: accountId,
      creatorId,
      platform: 'reveal',
      handle: 'creatrice_test',
      sessionState: 'none',
    });
    await app.modules.connectors.sessions.store({
      platformAccountId: accountId,
      session: JSON.stringify({
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }),
      correlationId: 'test',
      userId: null,
    });
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
    await fake.app.close();
  });

  it('ingests the last day’s messages once, a new one at the next poll, then stops on an expired session', async () => {
    // The first poll reads the last 24 hours (poll.ts): FakeReveal's own count of them.
    const now = Date.parse(fake.state().now);
    const lastDay = fake
      .state()
      .messages.filter((m) => Date.parse(m.createdAt) > now - 24 * 3_600_000).length;
    expect(lastDay).toBeGreaterThan(10);
    expect(await sessionState()).toBe('valid');

    await poll();
    expect(await messages()).toBe(lastDay);

    // Read again over the overlap: nothing twice.
    await poll();
    expect(await messages()).toBe(lastDay);

    await scenario([{ type: 'fan_message', conversationId: 'conv_05', text: 'Message de test nouveau' }]);
    await poll();
    expect(await messages()).toBe(lastDay + 1);

    await scenario([{ type: 'session_expired' }]);
    await poll();
    expect(await sessionState()).toBe('expired');
    const after = calls.length;
    await poll();
    expect(calls.length).toBe(after);
    expect(await messages()).toBe(lastDay + 1);
  });

  it('never writes the token in a log line', () => {
    const bearer = fake.authorization.slice('Bearer '.length);
    expect(sink.withMessage('reveal: call').length).toBeGreaterThan(0);
    expect(JSON.stringify(sink.lines)).not.toContain(bearer);
  });
});
