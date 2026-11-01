import {
  TeamMemberStatusSchema,
  TeamRoleSchema,
  teamScopeFor,
  UserRoleSchema,
  type TeamScope,
} from '@nirvana/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Isolation and access mode of a transaction, as Drizzle takes them. */
export type TransactionConfig = NonNullable<Parameters<Database['transaction']>[1]>;

/**
 * A read that spans several queries and must see one moment of the database (revue 09, G4): a conversation's state
 * and its drafts read in READ COMMITTED could straddle a commit and disagree.
 */
export const SNAPSHOT_READ: TransactionConfig = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
};

export interface DbClient {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

/** A pool and its Drizzle handle. The app connects as `nirvana_app` (RLS applies), ops as `nirvana_admin`. */
export function createDbClient(connectionString: string, options: PoolConfig = {}): DbClient {
  const pool = new Pool({ connectionString, max: 10, ...options });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool, close: () => pool.end() };
}

/**
 * Runs `fn` in a transaction scoped to one creator: every RLS policy compares `creator_id` with this value, so
 * nothing of another creator is visible or writable. `set_config(…, true)` is `SET LOCAL`: it ends with the
 * transaction and never leaks to the next user of the pooled connection.
 */
export function withTenant<T>(
  db: Database,
  creatorId: string,
  fn: (tx: Transaction) => Promise<T>,
  config?: TransactionConfig,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.creator_id', ${creatorId}, true)`);
    return fn(tx);
  }, config);
}

/**
 * Runs `fn` in a transaction scoped to one dashboard account, for the agency's tables without `creator_id` (team,
 * pay; ADR 0023). The scope is derived here, inside the transaction, from the database and never from the caller:
 * `owner` for the owner, `agency` for a manager while `active`, `self` for anyone else, including an unknown account.
 * Every team policy reads `app.user_id` and `app.team_scope`; outside this function they are unset and match nothing.
 */
export function withMember<T>(
  db: Database,
  userId: string,
  fn: (tx: Transaction, scope: TeamScope) => Promise<T>,
  config?: TransactionConfig,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const [account] = await tx
      .select({ role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    // His own row only: the scope is not set yet, so the policy lets him read nothing else.
    const [member] = await tx
      .select({ teamRole: schema.teamMembers.teamRole, status: schema.teamMembers.status })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.userId, userId));
    const role = UserRoleSchema.safeParse(account?.role);
    const scope = role.success
      ? teamScopeFor(
          role.data,
          member === undefined
            ? null
            : {
                teamRole: TeamRoleSchema.parse(member.teamRole),
                status: TeamMemberStatusSchema.parse(member.status),
              },
        )
      : 'self';
    await tx.execute(sql`select set_config('app.team_scope', ${scope}, true)`);
    return fn(tx, scope);
  }, config);
}

/**
 * `withMember` inside one creator, for the tables that carry both `creator_id` and `member_id` (shifts and templates,
 * later the shift reports; ADR 0023 § Données et RLS): their policies ask for the creator and for the member himself
 * or the scope `owner` | `agency`. A reader of several creators loops, one transaction per creator.
 */
export function withTenantMember<T>(
  db: Database,
  creatorId: string,
  userId: string,
  fn: (tx: Transaction, scope: TeamScope) => Promise<T>,
  config?: TransactionConfig,
): Promise<T> {
  return withMember(
    db,
    userId,
    async (tx, scope) => {
      await tx.execute(sql`select set_config('app.creator_id', ${creatorId}, true)`);
      return fn(tx, scope);
    },
    config,
  );
}

/**
 * Moves a `withMember` or `withTenantMember` transaction to another creator, for what touches several creators at
 * once: a reader of several creators, a swap of shifts on two creators, a leave whose approval reads every creator of
 * the member (ADR 0031). Still `SET LOCAL`. `allowed` is the list the caller checked first (the creators that exist,
 * the two of a swap, those of the member): a creator outside it throws, so that no caller opens a creator it did not
 * check. The policies still decide what the scope reads and writes in her.
 */
export async function enterCreator(
  tx: Transaction,
  creatorId: string,
  allowed: readonly string[],
): Promise<void> {
  if (!allowed.includes(creatorId)) throw new Error('enterCreator: creator outside the allowed list');
  await tx.execute(sql`select set_config('app.creator_id', ${creatorId}, true)`);
}

/**
 * Runs `fn` in a transaction on the admin connection (BYPASSRLS), for the multi-tenant system jobs only. Callers
 * are named `*Unscoped` so a review sees every place that crosses tenants.
 */
export function withAdmin<T>(adminDb: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return adminDb.transaction(fn);
}

/**
 * The advisory lock (member, pay period) of ADR 0023 § Paie: every write to a shift report takes it, and so does the
 * validation of the member's pay for that period (EQ-04), so that a late report and a validation never cross. Held
 * until the transaction ends; the policies do not hide it. `period` is the period's first day (`PayPeriod`).
 */
export async function lockMemberPeriod(tx: Transaction, memberId: string, period: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`payroll.member_period:${memberId}:${period}`}, 0))`,
  );
}

/**
 * The lock of a period's closing (ADR 0032), global: the validation of a statement, the recalculation of a period's
 * drafts and the writes of tiers, goals and the payout minimum take it, always before `lockMemberPeriod`. A report
 * never takes it: the registry of counted reports sends one validated during a closing to the next open period.
 */
export async function lockPayrollClose(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('payroll.close', 0))`);
}
