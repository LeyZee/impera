import { createHash } from 'node:crypto';

import { mentionsPrice, orderedSummary, scriptStepsOf } from '../domain/describe';
import { ScriptSummaryFailed } from '../domain/errors';
import type {
  DropDescriber,
  ScriptSummarizer,
  ScriptSummaryStore,
  ScriptToSummarize,
  ScriptVersions,
  SummarizedScript,
} from '../domain/ports';

export interface SummarizeDeps {
  readonly store: ScriptSummaryStore;
  readonly describer: Pick<DropDescriber, 'detailed'>;
  readonly summarizer: ScriptSummarizer;
  readonly versions: Pick<ScriptVersions, 'frozen'>;
}

/** The day's AI budget spent: asked again each hour, as a media's description is (ADR 0083 § 8). */
const BUDGET_DELAY_MS = 60 * 60_000;

export type SummarizeOutcome = 'summarized' | 'already' | 'off' | 'waiting' | 'gone' | 'later';

/**
 * Its slots, their media and the description each is told with, in the order of the slot keys: the same files with the
 * same descriptions, the same hash; a slot changed or a description corrected (a new row), another.
 */
function mediaHashOf(
  files: readonly { readonly slotKey: string; readonly mediaAssetId: string }[],
  descriptions: ReadonlyMap<string, { readonly descriptionId: string }>,
): string {
  const lines = files
    .map(
      (file) =>
        `${file.slotKey}=${file.mediaAssetId}=${descriptions.get(file.mediaAssetId)?.descriptionId ?? ''}`,
    )
    .sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

const withMedium = (
  file: ScriptToSummarize['files'][number],
): file is ScriptToSummarize['files'][number] & { readonly mediaAssetId: string } =>
  file.mediaAssetId !== null;

/**
 * `content_drops.summarize_script` (ADR 0083 § 6): a script she sent, once each of its photos and videos is described,
 * is told step by step by the brain from its cards and those descriptions, then summed up; kept for the agency to
 * validate beside the grid's prices. It waits while a file is still in the cleaning or a media undescribed (the job
 * comes back after each description), and does nothing while her switch is off. The code holds the steps: an answer
 * that tells others is a failure, retried. A sum or a currency is asked again once, then kept with its reason.
 * Replayable: the same media with the same descriptions, told with the same prompt, are left alone; a description
 * corrected or a new prompt tells the script again (a new row: the one validated stays).
 */
export async function summarizeScript(
  deps: SummarizeDeps,
  dropId: string,
  now: Date,
  correlationId: string,
): Promise<SummarizeOutcome> {
  const target = await deps.store.target(dropId);
  if (target === null) return 'gone';
  if (!target.describes) return 'off';
  if (!target.files.every(withMedium)) return 'waiting';
  const files = target.files.filter(withMedium);
  const seen = files.filter((file) => file.kind !== 'audio').map((file) => file.mediaAssetId);
  const descriptions = await deps.describer.detailed(seen);
  if (seen.some((id) => !descriptions.has(id))) return 'waiting';
  const mediaHash = mediaHashOf(files, descriptions);
  if (await deps.store.summarized(dropId, mediaHash, deps.summarizer.promptHash)) return 'already';

  const version = await deps.versions.frozen(target.versionId);
  if (version === null) return 'gone';

  const steps = scriptStepsOf(version.segments, files);
  if (steps.length === 0) return 'gone';
  const input = {
    creatorId: target.creatorId,
    scriptName: version.name,
    moment: target.moment ?? (version.moment === 'both' ? null : version.moment),
    steps: steps.map((step) => ({
      step: step.step,
      code: step.code,
      name: step.name,
      card: step.card,
      media: step.media.map((file) => ({
        kind: file.kind,
        durationS: file.durationS,
        description: descriptions.get(file.mediaAssetId)?.detailed ?? null,
      })),
    })),
  };

  const keys = steps.map((step) => step.step);
  const ask = async (): Promise<SummarizedScript | 'budget'> => {
    const answer = await deps.summarizer.summarize(input);
    if (answer.kind === 'budget') return 'budget';
    if (answer.kind === 'failed') throw new ScriptSummaryFailed(`drop ${dropId}: every model failed`);
    const content = orderedSummary(keys, answer.summary);
    if (content === null)
      throw new ScriptSummaryFailed(`drop ${dropId}: the steps told are not the script's`);
    return {
      mediaHash,
      content,
      reviewReasons: mentionsPrice(content) ? ['price'] : [],
      model: answer.model,
      promptHash: answer.promptHash,
    };
  };

  const first = await ask();
  if (first === 'budget') {
    await deps.store.later(
      target.creatorId,
      dropId,
      correlationId,
      new Date(now.getTime() + BUDGET_DELAY_MS),
    );
    return 'later';
  }
  // A sum or a currency: asked once more; kept with its reason if it stays, or if the budget ends meanwhile.
  const again = first.reviewReasons.length > 0 ? await ask() : first;
  await deps.store.save(target.creatorId, dropId, again === 'budget' ? first : again);
  return 'summarized';
}
