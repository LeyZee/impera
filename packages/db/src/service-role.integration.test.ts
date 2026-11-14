import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { ensureServiceLogin } from './migrate';
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

type Write = 'insert' | 'update' | 'delete';

/**
 * Every table the service role writes, and how (ADR 0087 § 2): what the `withAdmin` calls of the API and the worker
 * do, and nothing more. A migration that opens a table to it adds its line here, in the same PR; a table that is not
 * here is read only.
 */
const WRITES: Readonly<Record<string, readonly Write[]>> = {
  account: ['insert', 'update'],
  ai_credit_entries: ['insert', 'delete'],
  audit_log: ['insert'],
  calendar_links: ['insert', 'update'],
  commission_statement_lines: ['insert'],
  commission_statements: ['insert', 'update'],
  content_drop_files: ['update'],
  content_drops: ['update'],
  content_ideas: ['update'],
  content_requests: ['insert'],
  contractor_document_purges: ['insert'],
  creators: ['update'],
  domain_events: ['insert'],
  exchange_rates: ['insert'],
  extension_links: ['insert', 'update'],
  fan_facts: ['delete'],
  invitation_links: ['insert', 'update'],
  invoice_counters: ['insert', 'update'],
  invoice_events: ['insert'],
  invoice_lines: ['insert'],
  invoice_pdf_copies: ['insert'],
  invoice_pdfs: ['insert'],
  invoices: ['insert'],
  llm_calls: ['insert'],
  media_assets: ['insert', 'update'],
  media_descriptions: ['insert'],
  passkey: ['update', 'delete'],
  password_reset_links: ['insert', 'update'],
  pay_period_blocks: ['insert', 'update', 'delete'],
  pay_periods: ['insert'],
  platform_chatter_daily_stats: ['insert', 'update'],
  platform_daily_stats: ['insert', 'update'],
  platform_script_step_media: ['insert', 'delete'],
  platform_script_steps: ['insert', 'delete'],
  platform_scripts: ['insert', 'update'],
  provider_credentials: ['insert', 'update', 'delete'],
  push_server_keys: ['insert'],
  push_subscriptions: ['insert', 'update'],
  reward_gains: ['insert'],
  reward_streaks: ['insert', 'update'],
  sales_feed_chatter_reviews: ['insert', 'update'],
  sales_feed_chatters: ['insert', 'update'],
  sales_feed_credentials: ['insert', 'update', 'delete'],
  sales_feed_cursors: ['insert', 'update'],
  sales_feed_deliveries: ['insert', 'delete'],
  sales_feed_stats_calls: ['insert', 'update'],
  sales_feed_webhooks: ['insert', 'update', 'delete'],
  script_cadences: ['insert', 'update'],
  script_drop_summaries: ['insert'],
  script_structure_queue: ['delete'],
  script_structure_versions: ['update'],
  script_structures: ['update'],
  session: ['delete'],
  shift_reports: ['update'],
  shift_swap_requests: ['update'],
  shift_templates: ['update'],
  shifts: ['insert'],
  team_members: ['update'],
  telegram_bots: ['insert', 'update'],
  telegram_channels: ['insert', 'update'],
  telegram_chats: ['insert', 'update', 'delete'],
  telegram_deliveries: ['insert', 'update'],
  telegram_link_codes: ['insert', 'delete'],
  telegram_private_links: ['insert', 'update', 'delete'],
  telegram_routes: ['insert', 'delete'],
  telegram_settings: ['insert', 'delete'],
  telegram_state: ['update'],
  two_factor: ['delete'],
  user: ['insert', 'update'],
  verification: ['delete'],
  worker_heartbeats: ['insert', 'update', 'delete'],
};

/** Tables the service role does not even read. None today: a migration that closes one names it here. */
const CLOSED: readonly string[] = [];

describe('the service role (ADR 0087): rows only, where a migration opened them', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('crosses creators and can do nothing to roles, databases or structures', async () => {
    const { rows } = await test.service.db.execute<{
      superuser: boolean;
      bypass: boolean;
      roles: boolean;
      databases: boolean;
      owned: number;
      creates: boolean;
    }>(sql`
      select r.rolsuper as superuser, r.rolbypassrls as bypass, r.rolcreaterole as roles, r.rolcreatedb as databases,
             (select count(*)::int from pg_class c where pg_has_role(current_user, c.relowner, 'USAGE')) as owned,
             has_schema_privilege(current_user, 'public', 'CREATE')
               or has_schema_privilege(current_user, 'graphile_worker', 'CREATE')
               or has_database_privilege(current_user, current_database(), 'CREATE') as creates
        from pg_roles r where r.rolname = current_user`);
    expect(rows[0]).toEqual({
      superuser: false,
      bypass: true,
      roles: false,
      databases: false,
      owned: 0,
      creates: false,
    });
  });

  it('reads every table and writes only the ones listed, the way they are listed', async () => {
    const { rows } = await test.admin.db.execute<{
      name: string;
      reads: boolean;
      writes: Write[];
      more: boolean;
    }>(sql`
      select c.relname as name,
             has_table_privilege('impera_service', c.oid, 'SELECT') as reads,
             array_remove(array[
               case when has_table_privilege('impera_service', c.oid, 'INSERT') then 'insert' end,
               case when has_table_privilege('impera_service', c.oid, 'UPDATE') then 'update' end,
               case when has_table_privilege('impera_service', c.oid, 'DELETE') then 'delete' end
             ], null) as writes,
             has_table_privilege('impera_service', c.oid, 'TRUNCATE')
               or has_table_privilege('impera_service', c.oid, 'REFERENCES')
               or has_table_privilege('impera_service', c.oid, 'TRIGGER')
               or has_table_privilege('impera_service', c.oid, 'SELECT WITH GRANT OPTION') as more
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by c.relname`);
    expect(rows.length).toBeGreaterThan(100);
    expect(
      rows.filter((row) => row.reads === CLOSED.includes(row.name)).map((row) => row.name),
      'a table the service role does not read: its migration grants SELECT to impera_service, or names it in CLOSED',
    ).toEqual([]);
    expect(rows.filter((row) => row.more).map((row) => row.name)).toEqual([]);
    const written = Object.fromEntries(
      rows.filter((row) => row.writes.length > 0).map((row) => [row.name, row.writes]),
    );
    expect(written, 'the write rights of the service role and this list say the same thing').toEqual(WRITES);
  });

  it('adds to the audit log and never rewrites it', async () => {
    await test.service.db.execute(
      sql`insert into audit_log (id, action, entity) values (gen_random_uuid(), 'creator.updated', 'creator')`,
    );
    expect(await failure(test.service.db.execute(sql`update audit_log set action = 'x'`))).toMatch(
      /permission denied for table audit_log/,
    );
    expect(await failure(test.service.db.execute(sql`delete from audit_log`))).toMatch(
      /permission denied for table audit_log/,
    );
    expect(await failure(test.service.db.execute(sql`truncate audit_log`))).toMatch(
      /permission denied for table audit_log/,
    );
  });

  it('changes no structure, no policy and no right', async () => {
    const refused = async (statement: string): Promise<string> =>
      failure(test.service.db.execute(sql.raw(statement)));
    expect(await refused('create table public.anything (id int)')).toMatch(
      /permission denied for schema public/,
    );
    expect(await refused('alter table creators add column anything int')).toMatch(
      /must be owner of table creators/,
    );
    expect(await refused('drop table audit_log')).toMatch(/must be owner of table audit_log/);
    expect(await refused('alter table fans disable row level security')).toMatch(
      /must be owner of table fans/,
    );
    expect(await refused('alter table fans no force row level security')).toMatch(
      /must be owner of table fans/,
    );
    expect(await refused('create policy anything on fans using (true)')).toMatch(
      /must be owner of table fans/,
    );
    expect(await refused('create role anything')).toMatch(/permission denied to create role/);
    expect(await refused('alter role nirvana_app bypassrls')).toMatch(/permission denied/);
    expect(await refused('set role nirvana_admin')).toMatch(/permission denied to set role/);
    expect(await refused('create schema anything')).toMatch(/permission denied for database/);
    expect(await refused('alter table graphile_worker._private_jobs add column anything int')).toMatch(
      /must be owner of table _private_jobs/,
    );
  });

  it('uses the job queue the migrations made, and reads their status', async () => {
    const { rows } = await test.service.db.execute<{ id: string }>(
      sql`select id::text from graphile_worker.add_job('noop', '{}'::json)`,
    );
    expect(rows).toHaveLength(1);
    await test.service.db.execute(sql`select graphile_worker.remove_job(${'none'})`);
    const applied = await test.service.db.execute<{ applied: number }>(
      sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0]?.applied).toBeGreaterThan(100);
  });

  it('leaves a service role that already logs in alone, and takes no other role for it', async () => {
    expect(await ensureServiceLogin(test.admin, test.serviceUrl)).toBe(false);
    await expect(ensureServiceLogin(test.admin, test.appUrl)).rejects.toThrow(
      /DATABASE_SERVICE_URL must connect as impera_service/,
    );
    const noPassword = new URL(test.serviceUrl);
    noPassword.password = '';
    await expect(ensureServiceLogin(test.admin, noPassword.toString())).rejects.toThrow(
      /must carry a password/,
    );
  });

  it("may use every sequence of the public schema, and only reads the job queue's list of migrations", async () => {
    const sequences = await test.admin.db.execute<{ name: string; usable: boolean }>(sql`
      select c.relname as name, has_sequence_privilege('impera_service', c.oid, 'USAGE') as usable
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'S'`);
    expect(
      sequences.rows.filter((row) => !row.usable).map((row) => row.name),
      'a sequence the service role cannot use: its migration grants USAGE, SELECT to impera_service',
    ).toEqual([]);
    const { rows } = await test.admin.db.execute<{ reads: boolean; writes: boolean }>(sql`
      select has_table_privilege('impera_service', 'graphile_worker.migrations', 'SELECT') as reads,
             has_table_privilege('impera_service', 'graphile_worker.migrations', 'INSERT, UPDATE, DELETE') as writes`);
    expect(rows[0]).toEqual({ reads: true, writes: false });
  });
});
