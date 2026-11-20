import type { CreatorId, PlatformAccountId } from '@impera/contracts';

import { planPlatformScripts } from '../domain/platform-scripts';
import type {
  PlatformScriptImportStore,
  PlatformScriptSource,
  PreparedRecognitionStore,
} from '../domain/ports';
import { recognise } from '../domain/recognition';

/** What one import of an account did, counts only (never a name nor a text: they are the creator's). */
export type ImportPlatformScriptsRun =
  /** Not hers, gone, or she is archived: nothing read. */
  | { readonly outcome: 'unknown_account' }
  /** Its connector reads no scripts now (no session, no adapter, no `capabilities.scripts`): left as it was. */
  | { readonly outcome: 'skipped' }
  | {
      readonly outcome: 'imported';
      readonly added: number;
      readonly changed: number;
      readonly gone: number;
      /** Out of the base's bounds, not imported (`boundedPlatformScript`). */
      readonly refused: number;
      /** Scripts « prêt à copier » recognised in this import and closed (ADR 0112 § 23). */
      readonly recognised: number;
    };

interface ImportDeps {
  readonly store: PlatformScriptImportStore;
  readonly source: PlatformScriptSource;
  /** Ties the scripts « prêt à copier » to the native scripts they became (ADR 0112 § 23). */
  readonly recognition: PreparedRecognitionStore;
  /** Hears a recognition that failed, with its cause, for the log: the import stays written, the next one retries. */
  readonly onRecognitionFailed?: (error: unknown) => void;
}

/**
 * `scripts.import_platform_scripts` (ADR 0099 § 1 time 2, P6-01): one account's native scripts read from the platform
 * and mirrored, replayable. A script read for the first time is added; one changed on the platform, or back after it
 * was gone, is rewritten whole and active; one gone is deactivated, never deleted. A failed read throws and changes
 * nothing for the account (the job's retry): nothing is deactivated because the platform did not answer. No identity
 * is asked any more (ADR 0161 § 5): the agent reads ours on a recognised copy. A script « prêt à copier »
 * that a native script now matches in everything is then tied to it (ADR 0112 § 23).
 */
export async function importPlatformScripts(
  deps: ImportDeps,
  request: {
    readonly creatorId: CreatorId;
    readonly platformAccountId: PlatformAccountId;
    readonly correlationId: string;
  },
  now: Date,
): Promise<ImportPlatformScriptsRun> {
  const account = await deps.store.account(request.creatorId, request.platformAccountId);
  if (account === null) return { outcome: 'unknown_account' };
  const listed = await deps.source(account);
  if (listed === null) return { outcome: 'skipped' };
  const plan = planPlatformScripts(await deps.store.known(account.id), listed);
  await deps.store.apply(account, plan, now);
  // After the import is written, so that a script copied by hand since the last one is read first. A recognition that
  // fails (a tie written at the same moment by hand) never fails the import: the next one finds the script again.
  let recognised = 0;
  try {
    recognised = await deps.recognition.recognise(account, recognise, now);
  } catch (error) {
    deps.onRecognitionFailed?.(error);
  }
  return {
    outcome: 'imported',
    added: plan.added.length,
    changed: plan.changed.length,
    gone: plan.gone.length,
    refused: plan.refused,
    recognised,
  };
}
