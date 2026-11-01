import {
  AuditEntryIdSchema,
  BackupRunStatusSchema,
  EventIdSchema,
  EVENT_PAYLOADS,
  newId,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@nirvana/db';
import { z } from 'zod';

import type { BackupAlerts, BackupRequestsStore, BackupRunsReader, RestoreTestsStore } from '../domain/ports';
import type { StoredBackupRequest } from '../domain/run-requests';
import type { BackupRun } from '../domain/status';

/**
 * `backup_runs` is written by the `backup` service, a shell script outside the application: each row is parsed
 * before it is used (CLAUDE.md rule 6), row counts included, though the database's CHECKs already hold.
 */
const BackupRunRowSchema = z.object({
  status: BackupRunStatusSchema,
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  error: z.string().max(500).nullable(),
  rowCounts: z.record(z.string().min(1), z.number().int().nonnegative()).nullable(),
});

const columns = {
  status: schema.backupRuns.status,
  startedAt: schema.backupRuns.startedAt,
  finishedAt: schema.backupRuns.finishedAt,
  sizeBytes: schema.backupRuns.sizeBytes,
  error: schema.backupRuns.error,
  rowCounts: schema.backupRuns.rowCounts,
};

function toRun(row: unknown): BackupRun {
  const { status, startedAt, finishedAt, sizeBytes, error } = BackupRunRowSchema.parse(row);
  return { status, startedAt, finishedAt, sizeBytes, error };
}

/** Read with the application role: `backup_runs` is granted SELECT and has no RLS (no tenant data). */
export function createPostgresBackupRunsReader(db: Database): BackupRunsReader {
  return {
    async lastSucceededAt() {
      const [row] = await db
        .select(columns)
        .from(schema.backupRuns)
        .where(eq(schema.backupRuns.status, 'succeeded'))
        .orderBy(sql`${schema.backupRuns.finishedAt} desc`)
        .limit(1);
      return row === undefined ? null : toRun(row).finishedAt;
    },
    async latestRun() {
      const [row] = await db
        .select(columns)
        .from(schema.backupRuns)
        .orderBy(sql`${schema.backupRuns.startedAt} desc`)
        .limit(1);
      return row === undefined ? null : toRun(row);
    },
    async firstRunStartedAt() {
      const [row] = await db
        .select(columns)
        .from(schema.backupRuns)
        .orderBy(sql`${schema.backupRuns.startedAt} asc`)
        .limit(1);
      return row === undefined ? null : toRun(row).startedAt;
    },
  };
}

/**
 * `backup_overdue` in the outbox (ADR 0020 § 3), as `budget_threshold_crossed`: it belongs to no creator, so the row
 * has `creator_id` null and is written with the admin role (RLS). The API never runs the check, but two workers can:
 * the first writes the day's row, the other finds it (advisory lock). The payload is parsed by its contract before
 * it is written (docs/architecture/jsonb.md). The search looks back two days only: the day's row is younger than that,
 * and `domain_events_created_idx` then serves it instead of a scan of every conversation's events, each hour.
 */
export function createPostgresBackupAlerts(adminDb: Database): BackupAlerts {
  return {
    publishOverdue({ lastSucceededAt, day }) {
      const payload = EVENT_PAYLOADS.backup_overdue.parse({
        lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
        day,
      });
      return withAdmin(adminDb, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`backup_overdue:${day}`}))`);
        const seen = await tx.execute(sql`
          select 1 from domain_events where created_at >= now() - interval '2 days' and type = 'backup_overdue'
            and payload->>'day' = ${day} limit 1`);
        if (seen.rows.length > 0) return false;
        await tx.insert(schema.domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: null,
          type: 'backup_overdue',
          payload,
          actor: 'system',
          correlationId: `backup:${day}`,
          createdAt: new Date(),
        });
        return true;
      });
    },
  };
}

const StoredRestoreTestSchema = z.object({
  id: z.uuid(),
  backupRunId: z.uuid(),
  backupSha256: z.string().regex(/^[0-9a-f]{64}$/),
  backupFinishedAt: z.date(),
  testedAt: z.date(),
  durationSeconds: z.number().int().positive(),
  rowCountMismatches: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  enteredByUserId: z.string().min(1),
  createdAt: z.date(),
});

const restoreTestColumns = {
  id: schema.restoreTests.id,
  backupRunId: schema.restoreTests.backupRunId,
  backupSha256: schema.backupRuns.sha256,
  backupFinishedAt: schema.backupRuns.finishedAt,
  testedAt: schema.restoreTests.testedAt,
  durationSeconds: schema.restoreTests.durationSeconds,
  rowCountMismatches: schema.restoreTests.rowCountMismatches,
  notes: schema.restoreTests.notes,
  enteredByUserId: schema.restoreTests.enteredByUserId,
  createdAt: schema.restoreTests.createdAt,
};

/**
 * `restore_tests`, with the application role: SELECT and INSERT only, and a trigger that refuses UPDATE and DELETE
 * (migration 0019). The `audit_log` line goes in the same transaction, without the notes (free text).
 */
export function createPostgresRestoreTestsStore(db: Database): RestoreTestsStore {
  const joined = (tx: Pick<Database, 'select'>) =>
    tx
      .select(restoreTestColumns)
      .from(schema.restoreTests)
      .innerJoin(schema.backupRuns, eq(schema.backupRuns.id, schema.restoreTests.backupRunId));
  return {
    async findSucceededBackup(sha256) {
      const [row] = await db
        .select({ id: schema.backupRuns.id, finishedAt: schema.backupRuns.finishedAt })
        .from(schema.backupRuns)
        .where(and(eq(schema.backupRuns.sha256, sha256), eq(schema.backupRuns.status, 'succeeded')));
      if (row === undefined) return null;
      return z.object({ id: z.uuid(), finishedAt: z.date() }).parse(row);
    },
    record(entry, actor) {
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.restoreTests)
          .values(entry)
          .onConflictDoNothing({ target: schema.restoreTests.id })
          .returning({ id: schema.restoreTests.id });
        if (inserted.length > 0) {
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId: actor.userId,
            action: 'restore_test.record',
            entity: 'restore_test',
            entityId: entry.id,
            ip: actor.ip,
            details: { backupRunId: entry.backupRunId, rowCountMismatches: entry.rowCountMismatches },
          });
        }
        const [row] = await joined(tx).where(eq(schema.restoreTests.id, entry.id));
        return { inserted: inserted.length > 0, test: StoredRestoreTestSchema.parse(row) };
      });
    },
    async latest() {
      const [row] = await joined(db)
        .orderBy(sql`${schema.restoreTests.testedAt} desc, ${schema.restoreTests.createdAt} desc`)
        .limit(1);
      return row === undefined ? null : StoredRestoreTestSchema.parse(row);
    },
  };
}

const StoredBackupRequestSchema = z.object({
  id: z.uuid(),
  requestedAt: z.date(),
  requestedByUserId: z.string().min(1),
  pickedAt: z.date().nullable(),
});

const requestColumns = {
  id: schema.backupRequests.id,
  requestedAt: schema.backupRequests.requestedAt,
  requestedByUserId: schema.backupRequests.requestedByUserId,
  pickedAt: schema.backupRequests.pickedAt,
};

/**
 * `backup_requests` (REG-24), with the application role: SELECT and INSERT (migration 0039); the `backup` service marks
 * a request picked with the admin role. A transaction-scoped advisory lock serialises the requests, so two clicks
 * never make two; the `audit_log` line goes in the same transaction.
 */
export function createPostgresBackupRequestsStore(db: Database): BackupRequestsStore {
  const oldestPending = async (tx: Pick<Database, 'select'>): Promise<StoredBackupRequest | null> => {
    const [row] = await tx
      .select(requestColumns)
      .from(schema.backupRequests)
      .where(sql`${schema.backupRequests.pickedAt} is null`)
      .orderBy(schema.backupRequests.requestedAt)
      .limit(1);
    return row === undefined ? null : StoredBackupRequestSchema.parse(row);
  };
  return {
    request(entry, actor, decide) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('backups.request'))`);
        const [same] = await tx
          .select(requestColumns)
          .from(schema.backupRequests)
          .where(eq(schema.backupRequests.id, entry.id));
        const [latest] = await tx
          .select(columns)
          .from(schema.backupRuns)
          .orderBy(sql`${schema.backupRuns.startedAt} desc`)
          .limit(1);
        const decision = decide({
          sameId: same === undefined ? null : StoredBackupRequestSchema.parse(same),
          pending: await oldestPending(tx),
          latestRun: latest === undefined ? null : toRun(latest),
        });
        if (decision.kind === 'existing') return { created: false, request: decision.request };
        const [inserted] = await tx
          .insert(schema.backupRequests)
          .values({ id: entry.id, requestedByUserId: entry.requestedByUserId })
          .returning(requestColumns);
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: actor.userId,
          action: 'backup.request',
          entity: 'backup_request',
          entityId: entry.id,
          ip: actor.ip,
          details: {},
        });
        return { created: true, request: StoredBackupRequestSchema.parse(inserted) };
      });
    },
    pending: () => oldestPending(db),
  };
}
