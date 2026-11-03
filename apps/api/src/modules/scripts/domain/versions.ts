/**
 * Rule 6 of ADR 0056 § 1: a version asked of a creator, or being shot, is frozen. A save written over the latest
 * version changes it while it is not frozen, and writes the next one once it is; a save over an older version is stale.
 */
export type SaveDecision = 'stale' | 'update' | 'insert';

export function saveDecision(
  latest: { readonly version: number; readonly frozen: boolean },
  basedOnVersion: number,
): SaveDecision {
  if (basedOnVersion !== latest.version) return 'stale';
  return latest.frozen ? 'insert' : 'update';
}
