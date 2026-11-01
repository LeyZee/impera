import { describe, expect, it } from 'vitest';

import { checkTestedAt, isRestoreTestFresh, isSameTest, type RestoreTestEntry } from '../restore-tests';

const now = new Date('2026-10-27T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('restore tests (ADR 0028 § 6)', () => {
  it('is fresh up to 90 days after a test without mismatch, never after a failed one', () => {
    expect(isRestoreTestFresh(null, now)).toBe(false);
    expect(isRestoreTestFresh({ testedAt: daysAgo(90), rowCountMismatches: 0 }, now)).toBe(true);
    expect(isRestoreTestFresh({ testedAt: daysAgo(90.01), rowCountMismatches: 0 }, now)).toBe(false);
    expect(isRestoreTestFresh({ testedAt: daysAgo(1), rowCountMismatches: 1 }, now)).toBe(false);
  });

  it('reads `now` as the instant of the action: a test dated just after it still counts', () => {
    const justAfter = new Date(now.getTime() + 4 * 60_000);
    expect(isRestoreTestFresh({ testedAt: justAfter, rowCountMismatches: 0 }, now)).toBe(true);
  });

  it('dates a test after its export and at most 5 minutes ahead of the server', () => {
    const finished = daysAgo(2);
    expect(checkTestedAt(daysAgo(1), finished, now)).toBeNull();
    expect(checkTestedAt(finished, finished, now)).toBeNull();
    expect(checkTestedAt(daysAgo(3), finished, now)?.code).toBe('restore_test_before_backup_unprocessable');
    expect(checkTestedAt(new Date(now.getTime() + 5 * 60_000), finished, now)).toBeNull();
    expect(checkTestedAt(new Date(now.getTime() + 5 * 60_000 + 1), finished, now)?.code).toBe(
      'restore_test_in_future_unprocessable',
    );
  });

  it('calls two entries the same test only when every value and the author match', () => {
    const entry: RestoreTestEntry = {
      id: 't',
      backupRunId: 'b',
      testedAt: daysAgo(1),
      durationSeconds: 60,
      rowCountMismatches: 0,
      notes: null,
      enteredByUserId: 'owner',
    };
    expect(isSameTest(entry, { ...entry, testedAt: new Date(entry.testedAt.getTime()) })).toBe(true);
    expect(isSameTest(entry, { ...entry, notes: 'x' })).toBe(false);
    expect(isSameTest(entry, { ...entry, enteredByUserId: 'other' })).toBe(false);
  });
});
