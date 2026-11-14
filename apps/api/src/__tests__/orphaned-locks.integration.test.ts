import { sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { countOrphanedJobs, releaseOrphanedLocks } from '../orphaned-locks';
import { startWorker } from '../worker-runner';

import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { createSlowTask, SLOW_TASK } from './support/slow-task';

const LockSchema = z.array(
  z.object({ locked_by: z.string().nullable(), queue_locked_by: z.string().nullable() }),
);

/** A worker killed mid-job leaves its locks behind: they are freed once its heartbeat is gone (recette MOT-02). */
describe('locks of dead workers', () => {
  let test: TestDb;
  let app: App;

  /** A job of `queue`, locked `minutesAgo` by `pool`, as a worker that took it would leave it. */
  async function lockedJob(queue: string, pool: string, minutesAgo: number): Promise<void> {
    await test.admin.db.execute(sql`
      select graphile_worker.add_job('conversation.respond', '{}'::json, queue_name => ${queue}, max_attempts => 3)`);
    await test.admin.db.execute(sql`
      update graphile_worker._private_jobs
         set locked_by = ${pool}, locked_at = now() - make_interval(mins => ${minutesAgo}), attempts = 1
       where id = (select max(id) from graphile_worker._private_jobs)`);
    await test.admin.db.execute(sql`
      update graphile_worker._private_job_queues
         set locked_by = ${pool}, locked_at = now() - make_interval(mins => ${minutesAgo})
       where queue_name = ${queue}`);
  }

  async function heartbeat(pool: string, secondsAgo: number): Promise<void> {
    await test.admin.db.execute(sql`
      insert into worker_heartbeats (worker_id, hostname, version, last_seen_at)
      values (${pool}, 'host', 'test', now() - make_interval(secs => ${secondsAgo}))`);
  }

  async function locksOf(queue: string) {
    const result = await test.admin.db.execute(sql`
      select job.locked_by, q.locked_by as queue_locked_by
        from graphile_worker._private_jobs job
        join graphile_worker._private_job_queues q on q.id = job.job_queue_id
       where q.queue_name = ${queue}`);
    return LockSchema.parse(result.rows);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config, new LogSink()));
    // Graphile's schema comes with its first start.
    const worker = await startWorker(app, {
      logger: createLogger(config, new LogSink()),
      concurrency: 1,
      release: 'test',
      cronJobs: [],
    });
    await worker.stop();
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('frees the jobs and queues of a pool gone silent, never those of a live one, and /ready counts them until then', async () => {
    await heartbeat('pool-alive', 10);
    await heartbeat('pool-dead', 600);
    await lockedJob('conv:dead', 'pool-dead', 10);
    await lockedJob('account:gone', 'pool-never-seen', 10);
    await lockedJob('conv:alive', 'pool-alive', 10);
    // Locked a minute ago: maybe a worker whose first heartbeat is on its way.
    await lockedJob('conv:fresh', 'pool-starting', 1);

    expect(await countOrphanedJobs(test.service.db)).toBe(2);
    expect((await app.readiness()).orphanedJobs).toBe(2);

    expect((await releaseOrphanedLocks(test.service.db)).sort()).toEqual(['pool-dead', 'pool-never-seen']);
    expect(await locksOf('conv:dead')).toEqual([{ locked_by: null, queue_locked_by: null }]);
    expect(await locksOf('account:gone')).toEqual([{ locked_by: null, queue_locked_by: null }]);
    expect(await locksOf('conv:alive')).toEqual([{ locked_by: 'pool-alive', queue_locked_by: 'pool-alive' }]);
    expect(await locksOf('conv:fresh')).toEqual([
      { locked_by: 'pool-starting', queue_locked_by: 'pool-starting' },
    ]);
    expect(await countOrphanedJobs(test.service.db)).toBe(0);
    expect(await releaseOrphanedLocks(test.service.db)).toEqual([]);
  });

  it('a worker that starts runs the job a dead one left in its queue, and beats under its own pool id', async () => {
    const sink = new LogSink();
    const logger = createLogger(testConfig({ LOG_LEVEL: 'info' }), sink);
    await test.admin.db.execute(sql`
      select graphile_worker.add_job(${SLOW_TASK}, ${JSON.stringify({ seq: 1, delayMs: 10 })}::json,
        queue_name => 'conv:killed', max_attempts => 3)`);
    await test.admin.db.execute(sql`
      update graphile_worker._private_jobs set locked_by = 'pool-killed', locked_at = now() - interval '6 minutes'
       where task_id = (select id from graphile_worker._private_tasks where identifier = ${SLOW_TASK})`);
    await test.admin.db.execute(sql`
      update graphile_worker._private_job_queues set locked_by = 'pool-killed', locked_at = now() - interval '6 minutes'
       where queue_name = 'conv:killed'`);

    const worker = await startWorker(
      { ...app, tasks: { ...app.tasks, [SLOW_TASK]: createSlowTask(logger) } },
      { logger, concurrency: 1, release: 'test', cronJobs: [] },
    );
    try {
      await sink.waitFor('slow finished', 1, 15_000);
      expect(sink.withMessage('locks of dead workers released')).toMatchObject([
        { released: ['pool-killed'] },
      ]);
      const beats = z
        .array(z.object({ worker_id: z.string() }))
        .parse((await test.admin.db.execute(sql`select worker_id from worker_heartbeats`)).rows);
      expect(beats.map((beat) => beat.worker_id)).toContain(worker.workerId);
      expect(worker.workerId).toMatch(/^pool-/);
    } finally {
      await worker.stop();
    }
  });
});
