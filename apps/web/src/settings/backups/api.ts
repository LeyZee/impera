import {
  ApiErrorSchema,
  BACKUP_ERROR_CODES,
  BACKUP_RUN_ERROR_CODES,
  BackupRunRequestSchema,
  REAUTHENTICATION_ERROR_CODE,
  RestoreTestSchema,
  type BackupRunErrorCode,
  type BackupRunRequest,
  type BackupStatus,
  type RecordRestoreTestBody,
  type RestoreTest,
} from '@nirvana/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { watchIntervalOf, type REFUSALS } from './model';

import { backupStatusQuery } from '@/screens/dashboard/backups';

/**
 * `/v1/backups` as Réglages › Sauvegardes reads and writes it (ADR 0028, EQ-17), parsed with the contract. The status
 * is read through the Dashboard's own query: one cache, so a test entered here clears the banner there.
 */

export function useBackupStatusQuery(): UseQueryResult<BackupStatus> {
  return useQuery({ ...backupStatusQuery, refetchInterval: (query) => watchIntervalOf(query.state.data) });
}

export type RefusalCode = keyof typeof REFUSALS;

/**
 * `session_expired`: the session ended while the dialog was open (401). `rate_limited`: the server's limiter (429).
 * Both are answers, never « the server does not answer ».
 */
export type Outcome =
  | { readonly kind: 'ok'; readonly value: RestoreTest }
  | { readonly kind: 'refused'; readonly code: RefusalCode }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'failed' };

const isRefusal = (code: string): code is RefusalCode =>
  code === 'request_invalid' ||
  code === 'role_forbidden' ||
  BACKUP_ERROR_CODES.some((known) => known === code && known !== REAUTHENTICATION_ERROR_CODE);

/**
 * `POST /v1/backups/restore-tests` (owner, sign-in under 10 minutes). The same `id` sent twice is recorded once: a
 * retry after a lost answer is safe.
 */
export async function recordRestoreTest(body: RecordRestoreTestBody): Promise<Outcome> {
  try {
    const response = await fetch('/v1/backups/restore-tests', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return { kind: 'ok', value: RestoreTestSchema.parse(await response.json()) };
    if (response.status === 401) return { kind: 'session_expired' };
    if (response.status === 429) return { kind: 'rate_limited' };
    const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return { kind: 'failed' };
    const { code } = parsed.data.error;
    if (code === REAUTHENTICATION_ERROR_CODE) return { kind: 'reauth' };
    return isRefusal(code) ? { kind: 'refused', code } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** `in_progress`: an export runs now (409); its outcome will show on the strip. */
export type RunOutcome =
  | { readonly kind: 'ok'; readonly value: BackupRunRequest }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'reauth' }
  | { readonly kind: 'session_expired' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'failed' };

const isRunCode = (code: string): code is BackupRunErrorCode =>
  BACKUP_RUN_ERROR_CODES.some((known) => known === code);

/**
 * `POST /v1/backups/runs` (REG-24, owner, sign-in under 10 minutes): export now. The same `id` sent twice is one
 * request, and a request already waiting answers a second one: pressing again never queues two exports.
 */
export async function requestBackupRun(id: string): Promise<RunOutcome> {
  try {
    const response = await fetch('/v1/backups/runs', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (response.ok) return { kind: 'ok', value: BackupRunRequestSchema.parse(await response.json()) };
    if (response.status === 401) return { kind: 'session_expired' };
    if (response.status === 429) return { kind: 'rate_limited' };
    const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return { kind: 'failed' };
    const { code } = parsed.data.error;
    if (!isRunCode(code)) return { kind: 'failed' };
    return code === REAUTHENTICATION_ERROR_CODE ? { kind: 'reauth' } : { kind: 'in_progress' };
  } catch {
    return { kind: 'failed' };
  }
}
