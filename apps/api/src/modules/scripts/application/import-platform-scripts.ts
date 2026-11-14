import type { CreatorId, PlatformAccountId } from '@impera/contracts';

import { planPlatformScripts } from '../domain/platform-scripts';
import type { PlatformScriptImportStore, PlatformScriptSource } from '../domain/ports';

/** What one import of an account did, counts only (never a name nor a text: they are the creator's). */
export type ImportPlatformScriptsRun =
  /** Not hers, gone, or she is archived: nothing read. */
  | { readonly outcome: 'unknown_account' }
  /** Its connector reads no scripts now (no session, no adapter, no `capabilities.scripts`): left as it was. */
  | { readonly outcome: 'skipped' }
  | { readonly outcome: 'imported'; readonly added: number; readonly changed: number; readonly gone: number };

interface ImportDeps {
  readonly store: PlatformScriptImportStore;
  readonly source: PlatformScriptSource;
}

/**
 * `scripts.import_platform_scripts` (ADR 0099 § 1 time 2, P6-01): one account's native scripts read from the platform
 * and mirrored, replayable. A script read for the first time is added; one changed on the platform, or back after it
 * was gone, is rewritten whole and active; one gone is deactivated, never deleted. A failed read throws and changes
 * nothing for the account (the job's retry): nothing is deactivated because the platform did not answer.
 */
export async function importPlatformScripts(
  deps: ImportDeps,
  request: { readonly creatorId: CreatorId; readonly platformAccountId: PlatformAccountId },
  now: Date,
): Promise<ImportPlatformScriptsRun> {
  const account = await deps.store.account(request.creatorId, request.platformAccountId);
  if (account === null) return { outcome: 'unknown_account' };
  const listed = await deps.source(account);
  if (listed === null) return { outcome: 'skipped' };
  const plan = planPlatformScripts(await deps.store.known(account.id), listed);
  await deps.store.apply(account, plan, now);
  return {
    outcome: 'imported',
    added: plan.added.length,
    changed: plan.changed.length,
    gone: plan.gone.length,
  };
}
