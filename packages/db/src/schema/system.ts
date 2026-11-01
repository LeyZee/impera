import { BACKUP_RUN_STATUSES, type BackupRunStatus } from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { enumCheck, enumText, id, timestampTz } from './columns';

/** Written every 30 s by each worker, read by `/ready`. Out of RLS. */
export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  hostname: text('hostname').notNull(),
  version: text('version').notNull(),
  lastSeenAt: timestampTz('last_seen_at').notNull().defaultNow(),
});

/**
 * The API's shared rate limiter (ADR 0027): one counter per key and window, so every instance of the API counts the
 * same requests. Out of RLS (no tenant data). The key is hashed by the store, never an IP or an e-mail in clear; the
 * worker's `rate_limit.purge` removes a window an hour after it ends. UNLOGGED (migration 0017): a crash loses the
 * counters, which only opens a fresh window.
 */
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').primaryKey(),
    hits: integer('hits').notNull(),
    windowEndsAt: timestampTz('window_ends_at').notNull(),
  },
  (t) => [
    check('rate_limit_counters_key_check', sql`char_length(${t.key}) <= 512`),
    check('rate_limit_counters_hits_check', sql`${t.hits} > 0`),
    index('rate_limit_counters_window_ends_at_idx').on(t.windowEndsAt),
  ],
);

/**
 * One daily export of the database (ADR 0028, OPS-02), written by the `backup` service alone with the admin role,
 * read by the application. Out of RLS (no tenant data). The id has a database default, unlike `id()` of columns.ts:
 * psql writes these rows, not the application. A `running` row left by a crash stays visible and never counts as a
 * success. `row_counts` maps each table to its rows at the instant of the dump; `error` names the failed step, never
 * data.
 */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestampTz('started_at').notNull(),
    finishedAt: timestampTz('finished_at'),
    status: enumText('status').$type<BackupRunStatus>().notNull(),
    error: text('error'),
    objectKey: text('object_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: text('sha256'),
    pgDumpVersion: text('pg_dump_version'),
    rowCounts: jsonb('row_counts').$type<Record<string, number>>(),
  },
  (t) => [
    enumCheck('backup_runs', t.status, BACKUP_RUN_STATUSES),
    check('backup_runs_error_check', sql`char_length(${t.error}) <= 500`),
    check('backup_runs_sha256_check', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'backup_runs_row_counts_check',
      sql`${t.rowCounts} is null or jsonb_typeof(${t.rowCounts}) = 'object'`,
    ),
    check(
      'backup_runs_succeeded_check',
      sql`${t.status} <> 'succeeded' or (${t.finishedAt} is not null and ${t.sha256} is not null and ${t.sizeBytes} is not null and ${t.rowCounts} is not null)`,
    ),
    check('backup_runs_failed_check', sql`${t.status} <> 'failed' or ${t.finishedAt} is not null`),
    uniqueIndex('backup_runs_sha256_idx').on(t.sha256),
    index('backup_runs_status_finished_at_idx').on(t.status, t.finishedAt.desc()),
  ],
);

/**
 * A request to export now, out of the nightly hour (REG-24): the owner asks from Réglages › Sauvegardes, the `backup`
 * service picks it up within a minute and runs the same export as each night (`ops/db-export/export.sh`), which writes
 * its own `backup_runs` row. The application inserts and reads (migration 0039 grants), never runs the export
 * (ADR 0028 § 1). `id` is made by the client, so a request sent twice is one. Out of RLS: no tenant data.
 */
export const backupRequests = pgTable(
  'backup_requests',
  {
    id: uuid('id').primaryKey(),
    requestedAt: timestampTz('requested_at').notNull().defaultNow(),
    requestedByUserId: text('requested_by_user_id')
      .notNull()
      .references(() => user.id),
    /** Set by the `backup` service when it starts the export; null while the request waits. */
    pickedAt: timestampTz('picked_at'),
  },
  (t) => [
    index('backup_requests_pending_idx')
      .on(t.requestedAt)
      .where(sql`${t.pickedAt} is null`),
  ],
);

/**
 * A restore test of one export (ADR 0028 § 6), entered by the owner in the go-live state of the payroll (EQ-17): the
 * PC that ran it has no production credentials. The server matches the export by its SHA-256 to a succeeded
 * `backup_runs` row. Only the owner enters one: the route guarantees it (`requireRole('owner')`), not the database.
 * Append-only: a test is a fact of the past (trigger `refuse_change`, migration 0019).
 */
export const restoreTests = pgTable(
  'restore_tests',
  {
    id: id(),
    backupRunId: uuid('backup_run_id')
      .notNull()
      .references(() => backupRuns.id),
    testedAt: timestampTz('tested_at').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    rowCountMismatches: integer('row_count_mismatches').notNull(),
    notes: text('notes'),
    enteredByUserId: text('entered_by_user_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestampTz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('restore_tests_duration_check', sql`${t.durationSeconds} > 0`),
    check('restore_tests_mismatches_check', sql`${t.rowCountMismatches} >= 0`),
    check('restore_tests_notes_check', sql`char_length(${t.notes}) <= 500`),
    index('restore_tests_backup_run_id_idx').on(t.backupRunId),
  ],
);
