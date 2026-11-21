import type { CreatorId } from '@impera/contracts';

import type { ScriptIdentifier, ScriptIdentityJobStore } from '../domain/ports';
import { hasBranches, identityInputHash, identityReady } from '../domain/script-identity';

import { identitySourceOf } from './platform-script-reads';

/** The brain wrote nothing useful: every model failed. Thrown for the job's retry. */
export class ScriptIdentityFailed extends Error {
  override readonly name = 'ScriptIdentityFailed';
}

export type IdentifyOutcome =
  /** Written, to validate. */
  | 'identified'
  /** This version has one validated, by hand, or by the brain with the prompt of now. */
  | 'already'
  /**
   * A media not chosen for the CRM (ADR 0145 § 5), no media at all, or a photo or a video without a validated
   * description yet: nothing is paid, the hourly backlog asks again.
   */
  | 'waiting'
  /**
   * Branches (ADR 0112): its prompt reads the steps one after the other, so the agency writes such an identity by hand
   * until the prompt knows ranks.
   */
  | 'branched'
  /** Not hers, gone from the platform, or she is archived. */
  | 'gone'
  /** The day's AI budget is spent: the hourly backlog asks again. */
  | 'later';

interface IdentifyDeps {
  readonly store: ScriptIdentityJobStore;
  readonly brain: ScriptIdentifier;
}

/**
 * `scripts.identify_platform_script` (SC-04 lot c8, ADR 0056 § 6): an active native script, once each of its photos
 * and videos has a validated description, is told by the brain from its steps' names and texts and those
 * descriptions, never a price nor the moment; kept for the agency to validate. Replayable: a version that has a
 * validated identity, one written by hand, or one by the brain with the same prompt is left alone. A step or a media
 * changed, a description validated anew or a new prompt asks for a new row; the validated one stays, for its version.
 */
export async function identifyPlatformScript(
  deps: IdentifyDeps,
  request: { readonly creatorId: CreatorId; readonly platformScriptId: string },
): Promise<IdentifyOutcome> {
  const target = await deps.store.target(request.creatorId, request.platformScriptId);
  if (target === null) return 'gone';
  const { script, descriptions } = target;
  if (hasBranches(script.steps)) return 'branched';
  // Only a script whose every media the owner chose for the CRM (ADR 0145 § 5): nothing is told of what is not in it,
  // and a script without any media is never told of itself, with no gesture of hers (its identity is written by hand).
  const media = script.steps.flatMap((step) => [...step.media, ...step.previewMedia]);
  if (media.length === 0 || media.some((each) => each.vault?.imported !== true)) return 'waiting';
  const source = identitySourceOf(script);
  if (!identityReady(source)) return 'waiting';
  const inputHash = identityInputHash(source);
  const known = script.identities.some(
    (identity) =>
      identity.inputHash === inputHash &&
      (identity.validatedAt !== null ||
        identity.author === 'human' ||
        identity.promptHash === deps.brain.promptHash),
  );
  if (known) return 'already';

  const answer = await deps.brain.identify({
    creatorId: request.creatorId,
    scriptName: script.name,
    steps: source.steps.map((step) => ({
      name: step.name,
      text: step.text,
      media: [...step.media, ...step.previewMedia].map((media) => ({
        kind: media.kind,
        description: media.descriptionId === null ? null : (descriptions.get(media.descriptionId) ?? null),
      })),
    })),
  });
  if (answer.kind === 'budget') return 'later';
  if (answer.kind === 'failed') throw new ScriptIdentityFailed(`script ${script.id}: every model failed`);
  await deps.store.save(request.creatorId, script.id, {
    inputHash,
    content: answer.content,
    model: answer.model,
    promptHash: answer.promptHash,
  });
  return 'identified';
}
