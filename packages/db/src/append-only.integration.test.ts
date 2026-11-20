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

/**
 * Append-only tables whose trigger lets one change through, so the application role keeps UPDATE on them. A migration
 * that adds one names it here, with the change its trigger permits.
 */
const UPDATED_BY_THE_APP: readonly string[] = [
  // The purge of `moment` (0005) and an example withdrawn from her bank (ADR 0102 § 5): the trigger refuses the rest.
  'calibration_ratings',
];

describe('append-only tables (data-model.md): the rights say what the triggers say', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('gives neither the application role nor the service role a way to rewrite or empty one', async () => {
    const { rows } = await test.admin.db.execute<{ name: string; role: string; rights: string[] }>(sql`
      select c.relname as name, r.rolname as role,
             array_remove(array[
               case when has_any_column_privilege(r.oid, c.oid, 'UPDATE') then 'update' end,
               case when has_table_privilege(r.oid, c.oid, 'DELETE') then 'delete' end,
               case when has_table_privilege(r.oid, c.oid, 'TRUNCATE') then 'truncate' end
             ], null) as rights
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join pg_roles r
       where n.nspname = 'public'
         and r.rolname in ('nirvana_app', 'impera_service')
         and exists (select from pg_trigger t
                      where t.tgrelid = c.oid and not t.tgisinternal and t.tgname like '%\_append\_only')
       order by c.relname, r.rolname`);
    // Every table that carries the trigger, twice: the list is not empty by accident.
    expect(rows.length).toBeGreaterThan(80);
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['audit_log', 'conversation_events', 'domain_events', 'platform_sales']),
    );
    const open = rows
      .filter((row) => row.rights.length > 0)
      .map((row) => `${row.role} on ${row.name}: ${row.rights.join(', ')}`);
    expect(
      open,
      'an append-only table: its migration revokes UPDATE, DELETE and TRUNCATE, or names it in UPDATED_BY_THE_APP',
    ).toEqual(UPDATED_BY_THE_APP.map((name) => `nirvana_app on ${name}: update`));
  });

  it('lets the application role add to the audit log and refuses the rest before any trigger runs', async () => {
    await test.app.db.execute(
      sql`insert into audit_log (id, action, entity) values (gen_random_uuid(), 'creator.updated', 'creator')`,
    );
    for (const statement of [
      `update audit_log set action = 'x'`,
      'delete from audit_log',
      'truncate audit_log',
    ]) {
      expect(await failure(test.app.db.execute(sql.raw(statement))), statement).toMatch(
        /permission denied for table audit_log/,
      );
    }
  });
});
