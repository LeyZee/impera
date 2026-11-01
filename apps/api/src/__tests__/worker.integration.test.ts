import { CreatorIdSchema, newId, PlatformAccountIdSchema } from '@nirvana/contracts';
import { createDbClient, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { checkReadiness } from '../readiness';
import { buildServer } from '../server';
import { startWorker, type WorkerHandle } from '../worker-runner';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';
import { createSlowTask, enqueueSlow, SLOW_TASK } from './support/slow-task';

const SlowLineSchema = z.looseObject({ seq: z.number(), at: z.number() });

function slowLines(sink: LogSink, msg: 'slow started' | 'slow finished'): z.infer<typeof SlowLineSchema>[] {
  return sink.withMessage(msg).map((line) => SlowLineSchema.parse(line));
}

describe('worker (Graphile, ADR 0006)', () => {
  let test: TestDb;
  let app: App;
  let worker: WorkerHandle;
  const sink = new LogSink();

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      LOG_LEVEL: 'info',
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger, { composer: fixedComposer });
    worker = await startWorker(
      { ...app, tasks: { ...app.tasks, [SLOW_TASK]: createSlowTask(logger) } },
      {
        logger,
        concurrency: 5,
        release: 'test',
        cronJobs: [],
        heartbeatIntervalMs: 500,
      },
    );
  });

  afterAll(async () => {
    await worker.stop();
    await app.shutdown();
    await test.close();
  });

  it('runs the jobs of one conversation queue in order, never two at once', async () => {
    for (let seq = 0; seq < 10; seq += 1) {
      await enqueueSlow(test.admin.db, seq, 40, 'conv:x');
    }
    await sink.waitFor('slow finished', 10, 30_000);
    const started = slowLines(sink, 'slow started');
    const finished = slowLines(sink, 'slow finished');
    expect(started.map((line) => line.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let index = 1; index < 10; index += 1) {
      // Disjoint: each job starts after the previous one finished, despite a concurrency of 5.
      expect(started[index]!.at).toBeGreaterThanOrEqual(finished[index - 1]!.at);
    }
  });

  it('carries the request id from the route to the job logs', async () => {
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    const server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const owner = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
    await createOwner(app.auth, app.db.db, owner);
    const cookie = await signIn(server, owner.email, owner.password);

    // A conversation with a draft waiting: the approval enqueues `conversation.send` with the request id.
    const creatorId = newId(CreatorIdSchema);
    const platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    await activateDemoPersona(app, creatorId);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'test-corr' });
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: 'c-corr',
      platformFanId: 'f-corr',
      fanDisplayName: 'Fan',
      message: {
        ref: { platform: 'reveal', id: 'm-corr' },
        conversationRef: { platform: 'reveal', id: 'c-corr' },
        direction: 'inbound',
        text: 'coucou',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'ingest-corr',
    });
    await app.modules.conversations.jobs.respond(
      { creatorId, conversationId, correlationId: 'respond-corr' },
      { info: () => undefined, warn: () => undefined },
    );
    const [draft] = await test.admin.db.select().from(schema.drafts);
    const response = await server.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/drafts/${draft!.id}/approve?creatorId=${creatorId}`,
      payload: { bubbles: ['Coucou toi'] },
      headers: { cookie, origin: DASHBOARD_ORIGIN, 'x-request-id': 'req-corr-1' },
    });
    expect(response.statusCode, response.body).toBe(204);
    // No connector yet (P0-06): the send fails, and its log line carries the request id.
    const lines = await sink.waitFor('send: failed');
    expect(lines.at(-1)).toMatchObject({ correlationId: 'req-corr-1', task: 'conversation.send' });
    await server.close();
  });

  it('is ready with a fresh heartbeat, not ready once it is 90 s old or gone', async () => {
    expect(await app.readiness()).toMatchObject({
      isReady: true,
      checks: { database: true, migrations: true, worker: true },
    });

    await worker.stop();
    expect((await app.readiness()).checks.worker).toBe(false);

    const heartbeatAged = async (seconds: number): Promise<boolean> => {
      await test.admin.db.execute(sql`delete from worker_heartbeats`);
      await test.admin.db.execute(sql`
        insert into worker_heartbeats (worker_id, hostname, version, last_seen_at)
        values ('other', 'host', 'test', now() - make_interval(secs => ${seconds}))
      `);
      return (await app.readiness()).checks.worker;
    };
    expect(await heartbeatAged(30)).toBe(true);
    expect(await heartbeatAged(91)).toBe(false);
  });

  it('counts the jobs Graphile gave up on, without making the API unready', async () => {
    const before = (await app.readiness()).deadJobs ?? 0;
    await test.admin.db.execute(sql`
      select graphile_worker.add_job('conversation.respond', '{}'::json, max_attempts => 1, run_at => now() + interval '1 day')`);
    await test.admin.db.execute(sql`
      update graphile_worker._private_jobs set attempts = max_attempts, last_error = 'test'
      where id = (select max(id) from graphile_worker._private_jobs)`);
    const readiness = await app.readiness();
    expect(readiness.deadJobs).toBe(before + 1);
    expect(readiness.checks.database).toBe(true);
  });

  it('reports the database as down when it cannot be reached', async () => {
    const unreachable = createDbClient('postgres://nirvana_app:x@127.0.0.1:1/none', {
      connectionTimeoutMillis: 500,
    });
    unreachable.pool.on('error', () => undefined);
    const readiness = await checkReadiness(unreachable.db, unreachable.db);
    expect(readiness).toEqual({
      isReady: false,
      checks: { database: false, migrations: false, worker: false },
      deadJobs: null,
    });
    await unreachable.close();
  });
});
