import { sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { DEAD_JOB_RETENTION_DAYS, purgeDeadJobs } from '../dead-jobs';
import { createLogger } from '../logger';
import { startWorker } from '../worker-runner';

import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';

const KeysSchema = z.array(z.object({ key: z.string() }));

/** A job given up on stays in Graphile's queue with its payload: it goes after a while (relecture des données gardées). */
describe('jobs given up on long ago', () => {
  let test: TestDb;
  let app: App;

  /** A job keyed `key`, its attempts spent or not, last touched `daysAgo`, locked or not. */
  async function job(
    key: string,
    state: { spent: boolean; daysAgo: number; locked?: boolean },
  ): Promise<void> {
    await test.admin.db.execute(sql`
      select graphile_worker.add_job('conversation.record_facts', '{"note":"synthétique"}'::json,
                                     job_key => ${key}, max_attempts => 3)`);
    await test.admin.db.execute(sql`
      update graphile_worker._private_jobs
         set attempts = ${state.spent ? 3 : 1},
             updated_at = now() - make_interval(days => ${state.daysAgo}),
             locked_by = ${state.locked === true ? 'pool' : null},
             locked_at = ${state.locked === true ? sql`now()` : null}
       where key = ${key}`);
  }

  async function keys(): Promise<string[]> {
    const result = await test.admin.db.execute(
      sql`select key from graphile_worker._private_jobs order by key`,
    );
    return KeysSchema.parse(result.rows).map((row) => row.key);
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

  it('deletes only the jobs given up on for longer than the retention, never one held nor one still tried', async () => {
    const old = DEAD_JOB_RETENTION_DAYS + 1;
    await job('dead-old', { spent: true, daysAgo: old });
    await job('dead-recent', { spent: true, daysAgo: DEAD_JOB_RETENTION_DAYS - 1 });
    await job('dead-old-held', { spent: true, daysAgo: old, locked: true });
    await job('pending-old', { spent: false, daysAgo: old });

    expect(await purgeDeadJobs(app.adminDb.db)).toBe(1);
    expect(await keys()).toEqual(['dead-old-held', 'dead-recent', 'pending-old']);
    // Replayed, it finds nothing more.
    expect(await purgeDeadJobs(app.adminDb.db)).toBe(0);
  });
});
