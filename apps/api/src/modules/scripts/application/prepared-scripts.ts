import type {
  CopyDifference,
  CreatePreparedScriptBody,
  CreatorId,
  PreparedScriptContent,
  PreparedScriptGap,
  PreparedScriptId,
  PreparedScriptWarning,
  StaircaseSetting,
} from '@impera/contracts';

import type {
  CreatePreparedOutcome,
  LimitsOf,
  PreparedScriptStore,
  StoredPreparedScript,
} from '../domain/ports';
import { preparedScriptGaps, preparedScriptWarnings, preparedTransition } from '../domain/prepared-scripts';
import { copyDifferences } from '../domain/recognition';

/**
 * Scripts in preparation (ADR 0112 §§ 20-22): created, saved and made « prêt à copier » by the owner and the active
 * managers of her list. The gaps and warnings are counted at each read, never stored: a media described since, or a
 * persona changed, changes them without a save.
 */

export interface PreparedScriptView extends Omit<StoredPreparedScript, 'vault' | 'natives'> {
  readonly gaps: readonly PreparedScriptGap[];
  readonly warnings: readonly PreparedScriptWarning[];
  /** « Prêt à copier » only: what differs from Reveal for now (ADR 0112 § 23); `null` otherwise. */
  readonly copyDifferences: readonly CopyDifference[] | null;
}

interface Deps {
  readonly store: PreparedScriptStore;
  readonly limitsOf: LimitsOf;
}

function viewOf(
  script: StoredPreparedScript,
  limits: Awaited<ReturnType<LimitsOf>>,
  staircase?: StaircaseSetting,
): PreparedScriptView {
  const { vault, natives, ...rest } = script;
  return {
    ...rest,
    gaps: preparedScriptGaps(script.content, vault, limits),
    warnings: preparedScriptWarnings(script.content, staircase),
    copyDifferences: natives === null ? null : copyDifferences(script.content, natives),
  };
}

/** Her scripts in preparation, the latest changed first; `null` for a reader who may not read them. */
export async function listPreparedScripts(
  deps: Deps,
  userId: string,
  creatorId: CreatorId,
): Promise<PreparedScriptView[] | null> {
  const scripts = await deps.store.list(creatorId, userId);
  if (scripts === null) return null;
  const limits = await deps.limitsOf(creatorId);
  const staircase = await deps.store.staircase?.(creatorId);
  return scripts.map((script) => viewOf(script, limits, staircase));
}

export async function preparedScript(
  deps: Deps,
  userId: string,
  creatorId: CreatorId,
  id: PreparedScriptId,
): Promise<PreparedScriptView | null> {
  const script = await deps.store.one(creatorId, id, userId);
  if (script === null) return null;
  return viewOf(script, await deps.limitsOf(creatorId), await deps.store.staircase?.(creatorId));
}

export function createPreparedScript(
  deps: Pick<Deps, 'store'>,
  userId: string,
  creatorId: CreatorId,
  body: CreatePreparedScriptBody,
): Promise<CreatePreparedOutcome> {
  return deps.store.create(creatorId, body, userId);
}

export type ChangePreparedOutcome = 'updated' | 'stale' | 'closed' | 'gaps' | 'not_found';

/** A save: the content written on `basedOnRevision`; a script « prêt à copier » goes back to editing. */
export async function savePreparedScript(
  deps: Deps,
  userId: string,
  creatorId: CreatorId,
  id: PreparedScriptId,
  basedOnRevision: number,
  content: PreparedScriptContent,
): Promise<ChangePreparedOutcome> {
  const current = await deps.store.one(creatorId, id, userId);
  if (current === null) return 'not_found';
  const transition = preparedTransition(current.state, 'save', 0);
  if (!transition.ok) return 'closed';
  return deps.store.update(creatorId, id, { basedOnRevision, content, state: 'editing' }, userId);
}

/**
 * « Prêt à copier » without a gap, read on the revision named (§ 22); « en préparation » again, the other way. The
 * revision guards both: what the person saw is what changes state.
 */
export async function changePreparedState(
  deps: Deps,
  userId: string,
  creatorId: CreatorId,
  id: PreparedScriptId,
  basedOnRevision: number,
  to: 'ready' | 'editing',
): Promise<ChangePreparedOutcome> {
  const current = await deps.store.one(creatorId, id, userId);
  if (current === null) return 'not_found';
  if (current.revision !== basedOnRevision) return current.state === 'matched' ? 'closed' : 'stale';
  const gapCount =
    to === 'ready'
      ? preparedScriptGaps(current.content, current.vault, await deps.limitsOf(creatorId)).length
      : 0;
  const transition = preparedTransition(current.state, to, gapCount);
  if (!transition.ok) return transition.reason;
  if (transition.next === 'matched') return 'closed';
  return deps.store.update(creatorId, id, { basedOnRevision, content: null, state: transition.next }, userId);
}
