/* eslint-disable @typescript-eslint/explicit-module-boundary-types -- Drizzle builder types are inferred; spelled out they are unreadable and the schema files only chain them. */
import { sql, type SQL } from 'drizzle-orm';
import { check, pgPolicy, text, timestamp, uuid, type PgColumn } from 'drizzle-orm/pg-core';

/** Shared column builders and the tenant policy (data-model.md, ADR 0005). */

/** Application-generated UUID v7 primary key (ADR 0011): no database default. */
export const id = () => uuid('id').primaryKey();

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const timestampTz = (name: string) => timestamp(name, { withTimezone: true });

/** A closed value set stored as `text` + `check` (simpler to migrate than a Postgres enum). */
export const enumText = (name: string) => text(name);

export function enumCheck(table: string, column: PgColumn, values: readonly string[]) {
  const list = sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));
  return check(`${table}_${column.name}_check`, sql`${column} in (${list})`);
}

/** The tenant id the current transaction runs as, `NULL` outside `withTenant` (so the policy matches nothing). */
const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;

/** Rows of a table with `creator_id` are visible and writable only inside `withTenant` of that creator. */
export function tenantPolicy(creatorId: PgColumn) {
  return pgPolicy('tenant_isolation', {
    for: 'all',
    using: sql`${creatorId} = ${currentCreator}`,
    withCheck: sql`${creatorId} = ${currentCreator}`,
  });
}

/**
 * Same, plus reading the rows that belong to nobody (global kill switch). A tenant reads them but never writes,
 * changes or removes one: a global row is written only with `withAdmin` (`pnpm ops:kill-switch`), revue 09.
 */
export function tenantOrGlobalPolicy(creatorId: PgColumn) {
  return [
    tenantPolicy(creatorId),
    pgPolicy('global_read', { for: 'select', using: sql`${creatorId} is null` }),
  ];
}

/**
 * True unless the transaction runs as a creator's own account (`withCreatorAccount`, CR-02): another role for the
 * agency (`withMember`), unset for the jobs and the tests, so the restrictive policies below change nothing for them.
 */
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;

/**
 * A creator reads these rows of her own creator, never writes them (ADR 0042 § 2). Restrictive policies are ANDed
 * over the permissive ones, so no permissive policy can ever reopen them: each of her three permitted writes (CR-06)
 * replaces the restrictive policy of its table by one carved for it, `using (<not creator> or <that write>)`, with a
 * `GRANT UPDATE (<column>)` limited to the column it changes. A policy added beside this one would open nothing.
 */
export function creatorReadsOnly() {
  return [
    pgPolicy('creator_no_insert', { as: 'restrictive', for: 'insert', withCheck: notCreatorAccount }),
    pgPolicy('creator_no_update', { as: 'restrictive', for: 'update', using: notCreatorAccount }),
    pgPolicy('creator_no_delete', { as: 'restrictive', for: 'delete', using: notCreatorAccount }),
  ];
}

/** What only the agency reads, even of her own creator (ADR 0042 § 2): drafts, guard traces, model calls. */
export function closedToCreator() {
  return pgPolicy('creator_closed', { as: 'restrictive', for: 'all', using: notCreatorAccount });
}
