import { CreatorIdSchema, newId, PlatformAccountIdSchema, type PlatformAccountId } from '@nirvana/contracts';
import { schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { FakeConnector } from '../modules/connectors';
import { startWorker, type WorkerHandle } from '../worker-runner';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';

describe('connector.poll on the account queue (ADR 0006)', () => {
  let test: TestDb;
  let app: App;
  let worker: WorkerHandle;
  const sink = new LogSink();
  const fake = new FakeConnector();

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      LOG_LEVEL: 'info',
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger, {
      connectorRegistry: { reveal: () => fake },
      composer: fixedComposer,
    });
    worker = await startWorker(app, {
      logger,
      concurrency: 5,
      release: 'test',
      cronJobs: [],
      heartbeatIntervalMs: 500,
    });
  });

  afterAll(async () => {
    await worker.stop();
    await app.shutdown();
    await test.close();
  });

  it('runs two polls of one account one after the other, never at once', async () => {
    const creatorId = newId(CreatorIdSchema);
    const platformAccountId: PlatformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: platformAccountId,
      creatorId,
      platform: 'reveal',
      handle: 'serial',
      sessionState: 'valid',
    });
    fake.enqueueInbound({ conversationId: 'c-1', fanId: 'f-1', fanDisplayName: 'Julien', text: 'Salut' });
    fake.delayMs = 150;

    const payload = { creatorId, platformAccountId, correlationId: 'serial' };
    // No job key: two distinct polls, only the queue keeps them apart.
    await app.jobs.enqueue('connector.poll', payload, { queueName: `account:${platformAccountId}` });
    await app.jobs.enqueue('connector.poll', payload, { queueName: `account:${platformAccountId}` });
    await sink.waitFor('poll: done', 2, 30_000);
    expect(fake.calls.health).toBe(2);
    expect(fake.maxInFlight).toBe(1);
  });
});
