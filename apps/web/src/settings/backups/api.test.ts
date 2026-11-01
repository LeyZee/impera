import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordRestoreTest } from './api';

const BODY = {
  id: '0199f2a0-0000-7000-8000-000000000001',
  backupSha256: 'a'.repeat(64),
  testedAt: '2026-10-27T09:30:00.000Z',
  durationSeconds: 252,
  rowCountMismatches: 0,
  notes: null,
};

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recordRestoreTest', () => {
  it('gives the test back as recorded', async () => {
    answer(201, { ...BODY, createdAt: '2026-10-27T10:00:00.000Z' });
    expect(await recordRestoreTest(BODY)).toMatchObject({ kind: 'ok', value: { id: BODY.id } });
  });

  it('tells a refusal by its code, and the password asked again apart', async () => {
    answer(422, apiError('restore_test_backup_unprocessable'));
    expect(await recordRestoreTest(BODY)).toEqual({
      kind: 'refused',
      code: 'restore_test_backup_unprocessable',
    });
    answer(403, apiError('reauthentication_forbidden'));
    expect(await recordRestoreTest(BODY)).toEqual({ kind: 'reauth' });
  });

  it('tells an ended session and the limiter apart from a server that does not answer', async () => {
    answer(401, apiError('session_unauthenticated'));
    expect(await recordRestoreTest(BODY)).toEqual({ kind: 'session_expired' });
    answer(429, apiError('rate_limited'));
    expect(await recordRestoreTest(BODY)).toEqual({ kind: 'rate_limited' });
    answer(500, apiError('internal_error'));
    expect(await recordRestoreTest(BODY)).toEqual({ kind: 'failed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    expect(await recordRestoreTest(BODY)).toEqual({ kind: 'failed' });
  });
});
