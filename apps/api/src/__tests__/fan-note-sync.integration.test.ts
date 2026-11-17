import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  fanCardFieldSpec,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type FanId,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealApiConnectors } from '../modules/connectors';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';
import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;
const silent = { info: () => undefined, warn: () => undefined };

/**
 * ADR 0117 lot a: a fact written for a fan queues `connector.sync_fan_note`, which writes his card into the canvas lines
 * of his client note on FakeReveal (`quiet` world, invented fans) and keeps only keyed marks, under her RLS.
 */
describe('fan note: his card in his client note on FakeReveal (ADR 0117)', () => {
  let test: TestDb;
  let app: App;
  let fake: FakeReveal;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let fanId: FanId;

  async function note(): Promise<string> {
    const response = await fake.app.inject({
      method: 'GET',
      url: '/conversations/conv_01',
      headers: { authorization: fake.authorization },
    });
    return (
      z.object({ conversation: z.object({ note: z.string().optional() }) }).parse(response.json())
        .conversation.note ?? ''
    );
  }

  beforeAll(async () => {
    fake = createFakeReveal({ fixture: 'quiet' });
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    app = await createApp(config, createLogger(config, new LogSink()), {
      composer: fixedComposer,
      connectorsClock: () => fake.now(),
      connectorRegistry: {
        reveal: revealApiConnectors({
          fetch: fake.fetch,
          baseUrl: 'https://reveal.test',
          now: () => fake.now(),
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
    const fan = await app.modules.fans.upsertFanByPlatformId({
      creatorId,
      platformAccountId: accountId,
      platformFanId: 'fan_01',
      displayName: 'Fan test',
      seenAt: fake.now(),
    });
    fanId = fan.id;
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
    await fake.app.close();
  });

  it('a fact he said queues the sync; with writes on, the note gets the line and Impera keeps its fingerprint only', async () => {
    await app.modules.fans.proposeFacts(creatorId, fanId, [
      {
        category: fanCardFieldSpec('job').category,
        key: 'job',
        value: 'boulanger',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: null,
        observedAt: fake.now(),
      },
    ]);
    const queued = await test.admin.db.execute(
      sql`select payload from graphile_worker._private_jobs where key = ${`connector.sync_fan_note:${fanId}`}`,
    );
    expect(queued.rows).toHaveLength(1);

    // The guard is closed by default: nothing is written.
    await app.modules.connectors.jobs.syncFanNote({ creatorId, fanId, correlationId: 'test' }, silent);
    expect(await note()).toBe('');

    await test.admin.db
      .update(schema.platformAccounts)
      .set({ connectorConfig: { writes: true } })
      .where(eq(schema.platformAccounts.id, accountId));
    await app.modules.connectors.jobs.syncFanNote({ creatorId, fanId, correlationId: 'test' }, silent);
    expect(await note()).toBe('Métier : boulanger');
    const kept = await test.admin.db.select().from(schema.connectorNoteLines);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ platformFanId: 'fan_01', slot: 'job', owner: 'agent', corrected: false });
    expect(kept[0]?.lineHash).toMatch(/^v1:[0-9a-f]{64}$/u);
  });
});
