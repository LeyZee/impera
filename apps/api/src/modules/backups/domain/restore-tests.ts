import { DomainError, RESTORE_TEST_FRESH_DAYS } from '@nirvana/contracts';

/** A restore test as the owner enters it, the export already matched by its fingerprint. */
export interface RestoreTestEntry {
  readonly id: string;
  readonly backupRunId: string;
  readonly testedAt: Date;
  readonly durationSeconds: number;
  readonly rowCountMismatches: number;
  readonly notes: string | null;
  readonly enteredByUserId: string;
}

export interface StoredRestoreTest extends RestoreTestEntry {
  readonly backupSha256: string;
  /** When the restored export ended. */
  readonly backupFinishedAt: Date;
  readonly createdAt: Date;
}

/** A client clock a little ahead of the server's is no future test; more than this is. */
const FUTURE_MARGIN_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

export class RestoreTestBackupUnknown extends DomainError {
  constructor() {
    super('restore_test_backup_unprocessable', 'Aucune sauvegarde réussie ne porte cette empreinte');
  }
}

class RestoreTestBeforeBackup extends DomainError {
  constructor() {
    super('restore_test_before_backup_unprocessable', 'L’essai est daté d’avant la fin de cette sauvegarde');
  }
}

class RestoreTestInFuture extends DomainError {
  constructor() {
    super('restore_test_in_future_unprocessable', 'L’essai est daté dans le futur');
  }
}

export class RestoreTestConflict extends DomainError {
  constructor() {
    super('restore_test_conflict', 'Cet essai est déjà enregistré avec d’autres valeurs');
  }
}

/** A test is dated after its export ended, and not ahead of the server's clock (by more than 5 minutes). */
export function checkTestedAt(testedAt: Date, backupFinishedAt: Date, now: Date): DomainError | null {
  if (testedAt.getTime() > now.getTime() + FUTURE_MARGIN_MS) return new RestoreTestInFuture();
  if (testedAt.getTime() < backupFinishedAt.getTime()) return new RestoreTestBeforeBackup();
  return null;
}

/**
 * Whether the restore is proven now (EQ-17's pay guard): the latest test, by `testedAt`, found no mismatch and is at
 * most `RESTORE_TEST_FRESH_DAYS` old. A recent failed test means the restore is broken now.
 *
 * `now` is the instant of the action being guarded, never a past date: the latest test is the latest of all, so a test
 * dated after `now` counts as fresh (it can be, by up to the 5 minutes a client clock may run ahead).
 */
export function isRestoreTestFresh(
  latest: Pick<RestoreTestEntry, 'testedAt' | 'rowCountMismatches'> | null,
  now: Date,
): boolean {
  if (latest === null || latest.rowCountMismatches > 0) return false;
  return now.getTime() - latest.testedAt.getTime() <= RESTORE_TEST_FRESH_DAYS * DAY_MS;
}

/** The same test sent twice: every value the owner entered, and who entered it, are equal. */
export function isSameTest(stored: RestoreTestEntry, entry: RestoreTestEntry): boolean {
  return (
    stored.backupRunId === entry.backupRunId &&
    stored.testedAt.getTime() === entry.testedAt.getTime() &&
    stored.durationSeconds === entry.durationSeconds &&
    stored.rowCountMismatches === entry.rowCountMismatches &&
    stored.notes === entry.notes &&
    stored.enteredByUserId === entry.enteredByUserId
  );
}
