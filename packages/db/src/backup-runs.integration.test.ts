import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestDb, type TestDb } from './test/test-db';

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

const SHA = 'a'.repeat(64);

describe('backup_runs and restore_tests (ADR 0028): the daily export and its restore tests', () => {
  let test: TestDb;
  let runId: string;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // What the `backup` service writes, with the admin role.
    const { rows } = await test.admin.db.execute<{ id: string }>(sql`
      insert into backup_runs (started_at, finished_at, status, object_key, size_bytes, sha256, pg_dump_version, row_counts)
      values (now() - interval '2 minutes', now(), 'succeeded', 'backups/nirvana.tar.age', 1024, ${SHA},
              'pg_dump (PostgreSQL) 16.15', '{"creators": 2}')
      returning id`);
    runId = rows[0]?.id ?? '';
    await test.admin.db.execute(
      sql`insert into "user" (id, name, email, email_verified) values ('owner-1', 'Nora Vidal', 'owner@example.test', true)`,
    );
  });

  afterAll(async () => {
    await test.close();
  });

  it('lets the application read the runs, never write them', async () => {
    const { rows } = await test.app.db.execute<{ status: string }>(sql`select status from backup_runs`);
    expect(rows).toEqual([{ status: 'succeeded' }]);
    expect(
      await failure(
        test.app.db.execute(sql`insert into backup_runs (started_at, status) values (now(), 'running')`),
      ),
    ).toMatch(/permission denied/);
    expect(await failure(test.app.db.execute(sql`update backup_runs set status = 'failed'`))).toMatch(
      /permission denied/,
    );
    expect(await failure(test.app.db.execute(sql`delete from backup_runs`))).toMatch(/permission denied/);
  });

  it('refuses a success without its proof, a failure without its end, and counts that are not a map', async () => {
    expect(
      await failure(
        test.admin.db.execute(sql`
        insert into backup_runs (started_at, finished_at, status, size_bytes, row_counts)
        values (now(), now(), 'succeeded', 10, '{}')`),
      ),
    ).toMatch(/backup_runs_succeeded_check/);
    expect(
      await failure(
        test.admin.db.execute(sql`insert into backup_runs (started_at, status) values (now(), 'failed')`),
      ),
    ).toMatch(/backup_runs_failed_check/);
    expect(
      await failure(
        test.admin.db.execute(
          sql`insert into backup_runs (started_at, status, row_counts) values (now(), 'running', '3')`,
        ),
      ),
    ).toMatch(/backup_runs_row_counts_check/);
    expect(
      await failure(
        test.admin.db.execute(
          sql`insert into backup_runs (started_at, status, sha256) values (now(), 'running', 'xyz')`,
        ),
      ),
    ).toMatch(/backup_runs_sha256_check/);
  });

  it('lets the application enter a restore test, never change nor delete one, not even the admin role', async () => {
    await test.app.db.execute(sql`
      insert into restore_tests (id, backup_run_id, tested_at, duration_seconds, row_count_mismatches, entered_by_user_id)
      values (gen_random_uuid(), ${runId}, now(), 95, 0, 'owner-1')`);
    const { rows } = await test.app.db.execute<{ n: number }>(
      sql`select count(*)::int as n from restore_tests`,
    );
    expect(rows).toEqual([{ n: 1 }]);

    expect(await failure(test.app.db.execute(sql`update restore_tests set duration_seconds = 1`))).toMatch(
      /permission denied/,
    );
    expect(await failure(test.app.db.execute(sql`delete from restore_tests`))).toMatch(/permission denied/);
    expect(
      await failure(test.admin.db.execute(sql`update restore_tests set row_count_mismatches = 3`)),
    ).not.toBe('no error');
    expect(await failure(test.admin.db.execute(sql`delete from restore_tests`))).not.toBe('no error');
  });

  it('refuses a restore test that lasted nothing or counts negative mismatches', async () => {
    expect(
      await failure(
        test.app.db.execute(sql`
          insert into restore_tests (id, backup_run_id, tested_at, duration_seconds, row_count_mismatches, entered_by_user_id)
          values (gen_random_uuid(), ${runId}, now(), 0, 0, 'owner-1')`),
      ),
    ).toMatch(/restore_tests_duration_check/);
    expect(
      await failure(
        test.app.db.execute(sql`
          insert into restore_tests (id, backup_run_id, tested_at, duration_seconds, row_count_mismatches, entered_by_user_id)
          values (gen_random_uuid(), ${runId}, now(), 10, -1, 'owner-1')`),
      ),
    ).toMatch(/restore_tests_mismatches_check/);
  });
});
