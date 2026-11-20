import { readFile } from 'node:fs/promises';

import { sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { assertNoForeignAccess, readForeignAccess } from '../database-roles';

/** Played by hand as `postgres` on Supabase (deploy.md); here as the test server's superuser. */
const LOCK_DOWN = new URL('../../../../packages/db/supabase/lock-down.sql', import.meta.url);

/** The roles Supabase creates for its own services (ADR 0152 § 2), made here as it makes them: without a login. */
const PREDEFINED = ['anon', 'authenticated', 'service_role'];
/** Like Supabase's `supabase_read_only_user`: a member of `pg_read_all_data`, which no right of ours can close. */
const HOST_READER = 'host_reads_everything';
/** A role that may write every table is no accepted risk: none of Supabase's non-superusers is one. */
const HOST_WRITER = 'host_writes_everything';

const silent = { warn: () => undefined, info: () => undefined };

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
    await root.query(
      `do $$ begin create role ${HOST_READER} nologin in role pg_read_all_data; exception when duplicate_object then null; end $$`,
    );
  });

  afterAll(async () => {
    await root.end();
    await test.close();
  });

  it('keeps every function of ours out of reach of PUBLIC, and callable by our roles (migration 0234)', async () => {
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

  it('opens no function a later migration creates to PUBLIC: the default of the migrations role is closed', async () => {
    await test.admin.db.execute(
      sql`create function public.made_later() returns int language sql as 'select 1'`,
    );
    try {
      const rights = await root.query<{ anon: boolean; app: boolean }>(
        `select has_function_privilege('anon', 'public.made_later()', 'EXECUTE') as anon,
                has_function_privilege('nirvana_app', 'public.made_later()', 'EXECUTE') as app`,
      );
      // Its migration grants it to whom it serves; nobody gets it by default.
      expect(rights.rows[0]).toEqual({ anon: false, app: false });
    } finally {
      await test.admin.db.execute(sql`drop function public.made_later()`);
    }
  });

  it('gives each function of ours exactly the callers it serves, so a wider grant turns this red', async () => {
    const callers = await root.query<{ name: string; roles: string[] }>(
      `select p.proname as name,
              array(select r from unnest(array['nirvana_app', 'impera_service', 'anon']) r
                     where has_function_privilege(r, p.oid, 'EXECUTE') order by r) as roles
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.prorettype <> 'trigger'::regtype
          and not exists (select 1 from pg_depend d
                           where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        order by p.proname`,
    );
    // A new function goes here with the roles its migration grants it to. Trigger functions are left out: firing a
    // trigger checks no EXECUTE, and the test above already keeps them out of reach of the host's roles.
    expect(Object.fromEntries(callers.rows.map((row) => [row.name, row.roles]))).toEqual({
      calendar_agent: ['nirvana_app'],
      calendar_reader_scope: [],
      calendar_shifts: ['nirvana_app'],
      enqueue_job: ['impera_service', 'nirvana_app'],
      follow_own_time_zone: ['nirvana_app'],
      // Open to PUBLIC before 0234: our two roles keep them, nobody else.
      member_documents_open: ['impera_service', 'nirvana_app'],
      next_pay_period: ['impera_service', 'nirvana_app'],
      pay_period_closed: ['impera_service', 'nirvana_app'],
      pay_period_of: ['impera_service', 'nirvana_app'],
      pay_period_settled: ['impera_service', 'nirvana_app'],
    });
  });

  it('names an object not created by the role that ran the migrations', async () => {
    await root.query('create table public.made_by_hand (id int)');
    try {
      const { problems } = await readForeignAccess(test.service.db);
      expect(problems).toContainEqual(
        expect.stringMatching(
          /objects owned by [a-z_]+: only the role that ran the migrations \(nirvana_admin\)/,
        ),
      );
    } finally {
      await root.query('drop table public.made_by_hand');
    }
  });

  it('refuses a role of the host that may write every table, even one that reads everything too', async () => {
    await root.query(
      `do $$ begin create role ${HOST_WRITER} nologin in role pg_read_all_data, pg_write_all_data; exception when duplicate_object then null; end $$`,
    );
    try {
      const access = await readForeignAccess(test.service.db);
      expect(access.hostReaders).not.toContain(HOST_WRITER);
      expect(access.problems).toContainEqual(expect.stringContaining(`${HOST_WRITER} on public`));
    } finally {
      await root.query(`drop role ${HOST_WRITER}`);
    }
  });

  it('refuses to start in production until the lock-down is played, then lets our roles work as before', async () => {
    const warnings: string[] = [];
    const infos: string[] = [];
    const log = {
      warn: (message: string) => {
        warnings.push(message);
      },
      info: (message: string) => {
        infos.push(message);
      },
    };
    await expect(assertNoForeignAccess(test.service.db, true, log)).rejects.toThrow(
      /roles other than ours reach our schemas \(.*anon on public.*\): play packages\/db\/supabase/,
    );
    await assertNoForeignAccess(test.service.db, false, log);
    expect(warnings).toHaveLength(1);
    // The host's reader of everything is named, never refused: lock-down.sql cannot close it.
    expect(infos.join('\n')).toContain(HOST_READER);

    await root.query(await readFile(LOCK_DOWN, 'utf8'));
    // Twice: the runbook replays it after every upgrade of the host.
    await root.query(await readFile(LOCK_DOWN, 'utf8'));

    const after = await readForeignAccess(test.service.db);
    expect(after.problems).toEqual([]);
    expect(after.hostReaders).toContain(HOST_READER);
    await expect(assertNoForeignAccess(test.service.db, true, silent)).resolves.toBeUndefined();
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
