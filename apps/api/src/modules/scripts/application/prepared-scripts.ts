import type {
  CopyDifference,
  CreatePreparedScriptBody,
  CreatePreparedVersionBody,
  CreatorId,
  PreparedScriptContent,
  PreparedScriptGap,
  PreparedScriptId,
  PreparedScriptWarning,
} from '@impera/contracts';

import type {
  CreatePreparedOutcome,
  LimitsOf,
  PreparedScriptStore,
  StoredPreparedScript,
} from '../domain/ports';
import { preparedScriptGaps, preparedScriptWarnings, preparedTransition } from '../domain/prepared-scripts';
import { copyDifferences } from '../domain/recognition';
import { versionContentOf, versionGaps } from '../domain/script-versions';

/**
 * Scripts in preparation (ADR 0112 §§ 20-22): created, saved and made « prêt à copier » by the owner and the active
 * managers of her list. The gaps and warnings are counted at each read, never stored: a media described since, or a
 * persona changed, changes them without a save.
 */

export interface PreparedScriptView extends Omit<StoredPreparedScript, 'vault' | 'natives' | 'source'> {
  readonly gaps: readonly PreparedScriptGap[];
  readonly warnings: readonly PreparedScriptWarning[];
  /** « Prêt à copier » only: what differs from Reveal for now (ADR 0112 § 23); `null` otherwise. */
  readonly copyDifferences: readonly CopyDifference[] | null;
}

interface Deps {
  readonly store: PreparedScriptStore;
  readonly limitsOf: LimitsOf;
}

/** Its gaps: those of any script, and for a version those of ADR 0169 against its script. */
function gapsOf(script: StoredPreparedScript, limits: Awaited<ReturnType<LimitsOf>>): PreparedScriptGap[] {
  return [
    ...preparedScriptGaps(script.content, script.vault, limits),
    ...(script.source === null ? [] : versionGaps(script.source, script.content)),
  ];
}

function viewOf(script: StoredPreparedScript, limits: Awaited<ReturnType<LimitsOf>>): PreparedScriptView {
  const { natives } = script;
  return {
    id: script.id,
    creatorId: script.creatorId,
    platformAccountId: script.platformAccountId,
    state: script.state,
    revision: script.revision,
    content: script.content,
    language: script.language,
    versionOf: script.versionOf,
    matchedPlatformScriptId: script.matchedPlatformScriptId,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    gaps: gapsOf(script, limits),
    warnings: preparedScriptWarnings(script.content),
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
  return scripts.map((script) => viewOf(script, limits));
}

export async function preparedScript(
  deps: Deps,
  userId: string,
  creatorId: CreatorId,
  id: PreparedScriptId,
): Promise<PreparedScriptView | null> {
  const script = await deps.store.one(creatorId, id, userId);
  if (script === null) return null;
  return viewOf(script, await deps.limitsOf(creatorId));
}

export function createPreparedScript(
  deps: Pick<Deps, 'store'>,
  userId: string,
  creatorId: CreatorId,
  body: CreatePreparedScriptBody,
): Promise<CreatePreparedOutcome> {
  return deps.store.create(creatorId, { ...body, versionOf: null }, userId);
}

/**
 * Its version in another language (ADR 0169): made from the script as it stands, the same steps, media, prices and
 * conditions, its texts to translate, under the name given. `not_found` for a script the reader may not read.
 */
export async function createPreparedVersion(
  deps: Pick<Deps, 'store'>,
  userId: string,
  creatorId: CreatorId,
  sourceId: PreparedScriptId,
  body: CreatePreparedVersionBody,
): Promise<CreatePreparedOutcome> {
  const source = await deps.store.one(creatorId, sourceId, userId);
  if (source === null) return 'not_found';
  if (source.versionOf !== null) return 'version_conflict';
  return deps.store.create(
    creatorId,
    {
      id: body.id,
      platformAccountId: source.platformAccountId,
      content: { ...versionContentOf(source.content, null), name: body.name },
      language: body.language,
      versionOf: sourceId,
    },
    userId,
  );
}

/**
 * « Reprendre la structure » (ADR 0169): a version set right on its script as it stands now, keeping the texts of the
 * branches it had, on `basedOnRevision`; a script « prêt à copier » goes back to editing. `not_found` for a script that
 * is no version.
 */
export async function resyncPreparedVersion(
  deps: Pick<Deps, 'store'>,
  userId: string,
  creatorId: CreatorId,
  id: PreparedScriptId,
  basedOnRevision: number,
): Promise<ChangePreparedOutcome> {
  const current = await deps.store.one(creatorId, id, userId);
  if (current?.source == null) return 'not_found';
  const transition = preparedTransition(current.state, 'save', 0);
  if (!transition.ok) return 'closed';
  const content = versionContentOf(current.source, current.content);
  return deps.store.update(creatorId, id, { basedOnRevision, content, state: 'editing' }, userId);
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
  const gapCount = to === 'ready' ? gapsOf(current, await deps.limitsOf(creatorId)).length : 0;
  const transition = preparedTransition(current.state, to, gapCount);
  if (!transition.ok) return transition.reason;
  if (transition.next === 'matched') return 'closed';
  return deps.store.update(creatorId, id, { basedOnRevision, content: null, state: transition.next }, userId);
}
