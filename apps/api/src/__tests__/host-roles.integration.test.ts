import { readFile } from 'node:fs/promises';

import { sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { assertNoForeignAccess, foreignAccessProblems } from '../database-roles';

/** Played by hand as `postgres` on Supabase (deploy.md); here as the test server's superuser. */
const LOCK_DOWN = new URL('../../../../packages/db/supabase/lock-down.sql', import.meta.url);

/** The roles Supabase creates for its own services (ADR 0152 § 2), made here as it makes them: without a login. */
const PREDEFINED = ['anon', 'authenticated', 'service_role'];

const ENQUEUE_JOB = 'public.enqueue_job(text, jsonb, text, timestamptz, integer, text, text)';

describe("the host's own roles reach nothing of Impera (ADR 0152 § 2)", () => {
  let test: TestDb;
  let root: pg.Client;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const url = new URL(inject('pgSuperuserUrl'));
    url.pathname = new URL(test.appUrl).pathname;
    root = new pg.Client({ connectionString: url.toString() });
    await root.connect();
    for (const role of PREDEFINED) {
      // Roles belong to the whole server: another run may have made them already.
      await root.query(
        `do $$ begin create role ${role} nologin; exception when duplicate_object then null; end $$`,
      );
    }
  });

  afterAll(async () => {
    await root.end();
    await test.close();
  });

  it('keeps every function of ours out of reach of PUBLIC, and callable by our roles (migration 0231)', async () => {
    const rights = await root.query<{ anon: boolean; app: boolean; service: boolean }>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('nirvana_app', $1, 'EXECUTE') as app,
              has_function_privilege('impera_service', $1, 'EXECUTE') as service`,
      [ENQUEUE_JOB],
    );
    expect(rights.rows[0]).toEqual({ anon: false, app: true, service: true });
    const opened = await root.query<{ count: number }>(
      `select count(*)::int as count from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'graphile_worker'::regnamespace)
          and has_function_privilege('anon', p.oid, 'EXECUTE')
          and not exists (select 1 from pg_depend d
                           where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`,
    );
    expect(opened.rows[0]?.count).toBe(0);
  });

  it('names an object not created by the owner role', async () => {
    await root.query('create table public.made_by_hand (id int)');
    try {
      expect(await foreignAccessProblems(test.service.db)).toContainEqual(
        expect.stringMatching(/objects of several owners \(.*nirvana_admin.*\)/),
      );
    } finally {
      await root.query('drop table public.made_by_hand');
    }
  });

  it('refuses to start in production until the lock-down is played, then lets our roles work as before', async () => {
    const warnings: string[] = [];
    await expect(
      assertNoForeignAccess(test.service.db, true, (message) => {
        warnings.push(message);
      }),
    ).rejects.toThrow(/the host's roles reach our schemas \(anon on public.*\): play packages\/db\/supabase/);
    await assertNoForeignAccess(test.service.db, false, (message) => {
      warnings.push(message);
    });
    expect(warnings).toHaveLength(1);

    await root.query(await readFile(LOCK_DOWN, 'utf8'));
    // Twice: the runbook replays it after every upgrade of the host.
    await root.query(await readFile(LOCK_DOWN, 'utf8'));

    expect(await foreignAccessProblems(test.service.db)).toEqual([]);
    await expect(assertNoForeignAccess(test.service.db, true, () => undefined)).resolves.toBeUndefined();
    for (const role of PREDEFINED) {
      const reach = await root.query<{ public: boolean; queue: boolean }>(
        `select has_schema_privilege($1, 'public', 'USAGE') as public,
                has_schema_privilege($1, 'graphile_worker', 'USAGE') as queue`,
        [role],
      );
      expect(reach.rows[0]).toEqual({ public: false, queue: false });
    }

    // Our roles keep what they had: the app reads and enqueues, the service reaches the queue.
    await expect(
      test.app.db.execute(sql`select count(*) from information_schema.tables`),
    ).resolves.toBeDefined();
    const enqueued = await test.app.db.execute(
      sql`select public.enqueue_job('host_roles_probe', '{}'::jsonb) as id`,
    );
    expect(enqueued.rows).toHaveLength(1);
    await expect(
      test.service.db.execute(sql`select count(*) from graphile_worker.jobs`),
    ).resolves.toBeDefined();
  });
});
