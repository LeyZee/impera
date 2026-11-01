import { describe, expect, it } from 'vitest';

import { REAUTHENTICATION_ERROR_CODE } from './auth';
import { BACKUP_ERROR_CODES, BACKUP_RUN_ERROR_CODES, RecordRestoreTestBodySchema } from './backups';

const body = {
  id: '0195f0c0-0000-7000-8000-0000000000aa',
  backupSha256: 'A'.repeat(64),
  testedAt: '2026-10-25T14:00:00.000Z',
  durationSeconds: 1_260,
  rowCountMismatches: 0,
};

describe('restore test entry (ADR 0028 § 6)', () => {
  it('lowers the fingerprint and turns blank notes into none', () => {
    const parsed = RecordRestoreTestBodySchema.parse({ ...body, notes: '   ' });
    expect(parsed.backupSha256).toBe('a'.repeat(64));
    expect(parsed.notes).toBeNull();
    expect(RecordRestoreTestBodySchema.parse(body).notes).toBeNull();
    expect(RecordRestoreTestBodySchema.parse({ ...body, notes: ' ok ' }).notes).toBe('ok');
  });

  it('keeps the numbers inside what the integer columns hold', () => {
    const parse = (overrides: object) =>
      RecordRestoreTestBodySchema.safeParse({ ...body, ...overrides }).success;
    expect(parse({ durationSeconds: 86_400, rowCountMismatches: 1_000_000 })).toBe(true);
    expect(parse({ durationSeconds: 0 })).toBe(false);
    expect(parse({ durationSeconds: 86_401 })).toBe(false);
    expect(parse({ durationSeconds: 2.5 })).toBe(false);
    expect(parse({ rowCountMismatches: -1 })).toBe(false);
    expect(parse({ rowCountMismatches: 1_000_001 })).toBe(false);
    expect(parse({ backupSha256: 'g'.repeat(64) })).toBe(false);
    expect(parse({ notes: 'x'.repeat(501) })).toBe(false);
  });

  it('lists the sign-in error with its own, for the entry screen', () => {
    expect(BACKUP_ERROR_CODES).toContain(REAUTHENTICATION_ERROR_CODE);
    expect(BACKUP_RUN_ERROR_CODES).toContain(REAUTHENTICATION_ERROR_CODE);
  });
});
