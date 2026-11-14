import type { CreatorId } from '@impera/contracts';

import { planPlatformScripts } from '../domain/platform-scripts';
import type { ImportAccount, PlatformScriptImportStore, PlatformScriptSource } from '../domain/ports';

/** What one pass did, counts only (never a name nor a text: they are the creator's). */
export interface ImportPlatformScriptsRun {
  readonly accounts: number;
  /** Accounts whose connector reads no scripts: left as they were. */
  readonly skipped: number;
  readonly failed: number;
  readonly added: number;
  readonly changed: number;
  readonly gone: number;
}

interface ImportDeps {
  readonly store: PlatformScriptImportStore;
  readonly source: PlatformScriptSource;
  /** Hears each account whose import failed, with its cause, for the log; the next accounts still run. */
  readonly onFailure?: (creatorId: CreatorId, error: unknown) => void;
}

/**
 * `scripts.import_platform_scripts` (ADR 0099 § 1 time 2, P6-01): each account's native scripts read from the platform
 * and mirrored, rejouable. A script read for the first time is added; one changed on the platform, or back after it
 * was gone, is rewritten whole and active; one gone is deactivated, never deleted. A failed read changes nothing for
 * its account: nothing is deactivated because the platform did not answer.
 */
export async function importPlatformScripts(deps: ImportDeps, now: Date): Promise<ImportPlatformScriptsRun> {
  const run = { accounts: 0, skipped: 0, failed: 0, added: 0, changed: 0, gone: 0 };
  for (const account of await deps.store.accounts()) {
    run.accounts += 1;
    try {
      const outcome = await importAccount(deps, account, now);
      if (outcome === null) run.skipped += 1;
      else {
        run.added += outcome.added;
        run.changed += outcome.changed;
        run.gone += outcome.gone;
      }
    } catch (error) {
      run.failed += 1;
      deps.onFailure?.(account.creatorId, error);
    }
  }
  return run;
}

async function importAccount(
  deps: ImportDeps,
  account: ImportAccount,
  now: Date,
): Promise<{ added: number; changed: number; gone: number } | null> {
  const listed = await deps.source(account);
  if (listed === null) return null;
  const plan = planPlatformScripts(await deps.store.known(account.id), listed);
  await deps.store.apply(account, plan, now);
  return { added: plan.added.length, changed: plan.changed.length, gone: plan.gone.length };
}
