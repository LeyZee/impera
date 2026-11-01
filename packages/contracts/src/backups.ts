import { z } from 'zod';

import { REAUTHENTICATION_ERROR_CODE } from './auth';

/**
 * The daily encrypted export of the database (ADR 0028, OPS-02), as the application sees it: the rows the `backup`
 * service writes in `backup_runs`, never a file of the server.
 */

/** Where an export stands: `running` until it ends, then one of the two others. */
export const BACKUP_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;
export const BackupRunStatusSchema = z.enum(BACKUP_RUN_STATUSES);
export type BackupRunStatus = z.infer<typeof BackupRunStatusSchema>;

/**
 * `ok`: an export succeeded within the last 26 hours. `overdue`: the last success is older. `never`: no export has
 * ever succeeded. The rule is the server's (ADR 0028 § 5); the Dashboard shows `overdue` and `never` in amber.
 * Telegram follows `overdue`, and `never` only once the service has been trying for 26 hours: with no row at all
 * in `backup_runs` (the service never ran), the amber of the Dashboard is the only signal.
 */
export const BACKUP_STATES = ['ok', 'overdue', 'never'] as const;
export const BackupStateSchema = z.enum(BACKUP_STATES);
export type BackupState = z.infer<typeof BackupStateSchema>;

/** The latest run, whatever its outcome. `error` is the step that failed, written by the service, never data. */
export const BackupRunSummarySchema = z.object({
  status: BackupRunStatusSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  error: z.string().max(500).nullable(),
});
export type BackupRunSummary = z.infer<typeof BackupRunSummarySchema>;

/**
 * A restore test counts for this many days (ADR 0028 § 6: one per quarter). The pay guard of EQ-17 and the Dashboard
 * read the same bound.
 */
export const RESTORE_TEST_FRESH_DAYS = 90;

/**
 * The latest restore test by `testedAt`, as the status shows it. `backupFinishedAt` names the export it restored (when
 * that export ended), so that the proof reads « export du 25/10 restauré le 26/10 » without giving its fingerprint.
 */
export const RestoreTestSummarySchema = z.object({
  testedAt: z.iso.datetime(),
  backupFinishedAt: z.iso.datetime(),
  durationSeconds: z.number().int().positive(),
  rowCountMismatches: z.number().int().nonnegative(),
});
export type RestoreTestSummary = z.infer<typeof RestoreTestSummarySchema>;

/** `GET /v1/backups/status`, owner only. */
export const BackupStatusSchema = z.object({
  state: BackupStateSchema,
  lastSucceededAt: z.iso.datetime().nullable(),
  /** Hours the export may go without success before `overdue` (26). */
  overdueAfterHours: z.number().int().positive(),
  lastRun: BackupRunSummarySchema.nullable(),
  lastRestoreTest: RestoreTestSummarySchema.nullable(),
  /**
   * The latest restore test found no row count mismatch and is at most `RESTORE_TEST_FRESH_DAYS` old. Read on the
   * latest test only: a recent failed one means the restore is broken now, whatever older ones said.
   */
  restoreTestFresh: z.boolean(),
  /**
   * When the owner asked for an export now (REG-24) and the `backup` service has not picked it up yet; absent when no
   * request waits. Once picked, the export shows as `lastRun` (`running`, then its outcome).
   */
  runRequestedAt: z.iso.datetime().exactOptional(),
});
export type BackupStatus = z.infer<typeof BackupStatusSchema>;

const Sha256Schema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase());

/**
 * `POST /v1/backups/restore-tests`, owner only, after a recent sign-in: the owner enters the quarterly test played on
 * the PC (ADR 0028 § 6). `id` is made by the client when the form opens: sending the same test twice records it once
 * (the table is append-only). The fingerprint is the one `restore-check.sh` printed; it must name an export that
 * succeeded. `testedAt` is when the test ended, the moment the row counts were compared.
 */
export const RecordRestoreTestBodySchema = z.object({
  id: z.uuid(),
  backupSha256: Sha256Schema,
  testedAt: z.iso.datetime(),
  durationSeconds: z.number().int().min(1).max(86_400),
  rowCountMismatches: z.number().int().min(0).max(1_000_000),
  /** Trimmed; empty means none. */
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value)),
});
export type RecordRestoreTestBody = z.input<typeof RecordRestoreTestBodySchema>;

/** A recorded restore test: 201 when it is new, 200 when the same `id` was already recorded with the same values. */
export const RestoreTestSchema = z.object({
  id: z.uuid(),
  backupSha256: z.string().regex(/^[0-9a-f]{64}$/),
  testedAt: z.iso.datetime(),
  durationSeconds: z.number().int().positive(),
  rowCountMismatches: z.number().int().nonnegative(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type RestoreTest = z.infer<typeof RestoreTestSchema>;

/**
 * `POST /v1/backups/runs`, owner only, after a recent sign-in (REG-24): export now, out of the nightly hour. The
 * `backup` service runs the same export as each night (ADR 0028 § 1); the API only records the request. `id` is made
 * by the client when the button is pressed: the same request sent twice is one.
 */
export const RequestBackupRunBodySchema = z.object({ id: z.uuid() });
export type RequestBackupRunBody = z.infer<typeof RequestBackupRunBodySchema>;

/**
 * A request to export now: 202 when it is new, 200 when one already waits (this one or another: one at a time).
 * `pickedAt` is when the `backup` service started the export.
 */
export const BackupRunRequestSchema = z.object({
  id: z.uuid(),
  requestedAt: z.iso.datetime(),
  pickedAt: z.iso.datetime().nullable(),
});
export type BackupRunRequest = z.infer<typeof BackupRunRequestSchema>;

/**
 * The error codes of `POST /v1/backups/restore-tests`. `reauthentication_forbidden`: sign-in older than 10 minutes.
 * `restore_test_backup_unprocessable`: no export succeeded with this fingerprint.
 * `restore_test_before_backup_unprocessable`: the test is dated before the export ended.
 * `restore_test_in_future_unprocessable`: dated more than 5 minutes ahead of the server's clock.
 * `restore_test_conflict`: this `id` is already recorded with other values.
 */
export const BACKUP_ERROR_CODES = [
  'restore_test_backup_unprocessable',
  'restore_test_before_backup_unprocessable',
  'restore_test_in_future_unprocessable',
  'restore_test_conflict',
  REAUTHENTICATION_ERROR_CODE,
] as const;
export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

/**
 * The error codes of `POST /v1/backups/runs`. `backup_run_in_progress_conflict`: an export is running now (started less
 * than 26 hours ago); its outcome shows on the page. `reauthentication_forbidden`: sign-in older than 10 minutes.
 */
export const BACKUP_RUN_ERROR_CODES = [
  'backup_run_in_progress_conflict',
  REAUTHENTICATION_ERROR_CODE,
] as const;
export type BackupRunErrorCode = (typeof BACKUP_RUN_ERROR_CODES)[number];
