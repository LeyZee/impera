import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createTestDb, type TestDb } from './test/test-db';

/**
 * What every policy of the catalogue must say, read from Postgres itself (audit des tests d'isolation, 06/11): a table
 * added tomorrow with a policy that forgets its tenant fails here, before any route could reach it. The rules:
 * - on a table with a `creator_id`, each permissive policy binds `app.creator_id` in what it lets read or touch
 *   (`USING`) and in what it lets write (`WITH CHECK`, or `USING` when Postgres reuses it);
 * - on a table without one, each permissive policy binds the person (`app.user_id`), the team's reach
 *   (`app.team_scope`, `app.account_role`) or the creator;
 * - no permissive policy is `true`;
 * - a table under RLS without any policy is closed to `nirvana_app`, and a table outside RLS it may reach is listed below.
 * An exception says why it holds; a new one is a decision, read by the reviewer of the policy.
 */

/** Policies that delegate their tenant to another table under RLS, or open on purpose: `table.policy` → why. */
const POLICY_EXCEPTIONS: Readonly<Record<string, string>> = {
  'invoice_events.member_read': 'EXISTS on invoices, itself under RLS by member and team scope',
  'invoice_lines.member_read': 'EXISTS on invoices, itself under RLS by member and team scope',
  'invoice_pdf_copies.member_read': 'EXISTS on invoices, itself under RLS by member and team scope',
  'invoice_pdfs.member_read': 'EXISTS on invoices, itself under RLS by member and team scope',
  'kill_switches.global_read':
    'creator_id IS NULL: the global switch, read by every creator (migration 0010)',
  'shift_swap_requests.requester_withdraw':
    'USING binds the creator; WITH CHECK names the member through team_members, under RLS',
  'shift_swap_requests.target_answer':
    'USING binds the creator; WITH CHECK names the member through team_members, under RLS',
};

/** Under RLS without a policy: only `withAdmin` reads them (ADR 0068). */
const CLOSED_TABLES = ['password_reset_links', 'telegram_link_codes', 'telegram_private_links'];

/**
 * Outside RLS and still reachable by `nirvana_app`, as data-model.md § RLS « Hors RLS » says, with why. A table that
 * comes here holds nothing of one creator, or is filtered by its module on a key the person cannot choose.
 */
const OPEN_TABLES: Readonly<Record<string, string>> = {
  account: 'Better Auth: read and written by the auth library on the session user',
  audit_log: 'who did what, written by every module; read by the agency (ADR 0028)',
  backup_requests: 'agency-level backup asks (ADR 0028)',
  backup_runs: 'agency-level backup history (ADR 0028)',
  creators: 'the tenants’ register; no DELETE for the application (ADR 0071, migration 0125)',
  passkey: 'Better Auth, on the session user',
  rate_limit_counters: 'counters keyed by a hash, no person’s data',
  restore_tests: 'agency-level restore history (ADR 0028)',
  sales_feed_cursors: 'where the reading of the sales register stands, agency level',
  sales_feed_models: 'link of a platform model to a creator, set by the owner (ADR 0050 § 3)',
  session: 'Better Auth, on the session user',
  two_factor: 'Better Auth, on the session user',
  user: 'Better Auth: the accounts, read by their module on the session',
  verification: 'Better Auth: short-lived codes keyed by a token',
  worker_heartbeats: 'liveness of the workers, no person’s data',
};

/**
 * Of those, the ones that still carry a `creator_id`: a link, never a creator's own data, kept outside RLS on purpose
 * because the sales register reads it before it knows which creator a line belongs to.
 */
const OPEN_WITH_CREATOR = ['sales_feed_models'];

const PolicySchema = z.object({
  table: z.string(),
  policy: z.string(),
  permissive: z.string(),
  cmd: z.string(),
  qual: z.string().nullable(),
  withCheck: z.string().nullable(),
  hasCreator: z.boolean(),
});
type Policy = z.infer<typeof PolicySchema>;

const CREATOR = `current_setting('app.creator_id'`;
const ANY_TENANT = /current_setting\('app\.(creator_id|user_id|team_scope|account_role)'/u;
const READS = new Set(['SELECT', 'UPDATE', 'DELETE', 'ALL']);
const WRITES = new Set(['INSERT', 'UPDATE', 'ALL']);

/** What is wrong with one policy, empty when it holds. */
function faults(policy: Policy): string[] {
  const found: string[] = [];
  const written = policy.withCheck ?? policy.qual;
  if (policy.qual === 'true' || policy.withCheck === 'true') found.push('true');
  if (policy.hasCreator) {
    if (READS.has(policy.cmd) && !(policy.qual ?? '').includes(CREATOR))
      found.push('USING without app.creator_id');
    if (WRITES.has(policy.cmd) && !(written ?? '').includes(CREATOR))
      found.push('WITH CHECK without app.creator_id');
  } else if (!ANY_TENANT.test(`${policy.qual ?? ''} ${policy.withCheck ?? ''}`)) {
    found.push('binds no tenant, member nor team scope');
  }
  return found;
}

describe('the policies of the catalogue (audit des tests d’isolation, 06/11)', () => {
  let test: TestDb;
  let policies: Policy[];

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const result = await test.admin.db.execute(sql`
      select p.tablename as "table", p.policyname as "policy", p.permissive, p.cmd, p.qual,
             p.with_check as "withCheck",
             exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = p.tablename
                        and c.column_name = 'creator_id') as "hasCreator"
        from pg_policies p where p.schemaname = 'public' order by 1, 2`);
    policies = z.array(PolicySchema).parse(result.rows);
  });

  afterAll(async () => {
    await test.close();
  });

  it('every permissive policy binds its tenant, but for the exceptions said', () => {
    const wrong = policies
      .filter((p) => p.permissive === 'PERMISSIVE' && !(`${p.table}.${p.policy}` in POLICY_EXCEPTIONS))
      .flatMap((p) => faults(p).map((fault) => `${p.table}.${p.policy} (${p.cmd}): ${fault}`));
    expect(wrong).toEqual([]);
  });

  it('every exception still names a policy that needs it', () => {
    const needed = policies
      .filter((p) => p.permissive === 'PERMISSIVE' && faults(p).length > 0)
      .map((p) => `${p.table}.${p.policy}`);
    expect(Object.keys(POLICY_EXCEPTIONS).sort()).toEqual(needed.sort());
  });

  it('a table under RLS without a policy is listed and closed to the application', async () => {
    const result = await test.admin.db.execute(sql`
      select c.relname as name,
             has_table_privilege('nirvana_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE') as reachable
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
       order by 1`);
    const rows = z.array(z.object({ name: z.string(), reachable: z.boolean() })).parse(result.rows);
    expect(rows.map((r) => r.name)).toEqual(CLOSED_TABLES);
    expect(rows.filter((r) => r.reachable)).toEqual([]);
  });

  it('a table outside RLS that the application may reach is listed, and only the links said carry a creator_id', async () => {
    const result = await test.admin.db.execute(sql`
      select c.relname as name,
             exists (select 1 from information_schema.columns k
                      where k.table_schema = 'public' and k.table_name = c.relname
                        and k.column_name = 'creator_id') as "hasCreator"
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
         and has_table_privilege('nirvana_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
       order by 1`);
    const rows = z.array(z.object({ name: z.string(), hasCreator: z.boolean() })).parse(result.rows);
    expect(rows.map((r) => r.name)).toEqual(Object.keys(OPEN_TABLES).sort());
    expect(rows.filter((r) => r.hasCreator).map((r) => r.name)).toEqual(OPEN_WITH_CREATOR);
  });
});
