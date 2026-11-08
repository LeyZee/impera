import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { dropContextOf, type DropMediaContext } from '../domain/describe';
import { DropDescriptionFailed } from '../domain/errors';
import type {
  DescriptionQueue,
  DropDescriber,
  DropStorage,
  MediaToDescribe,
  ScratchRoom,
  ScriptVersions,
} from '../domain/ports';

export interface DescribeDeps {
  readonly storage: DropStorage;
  readonly queue: DescriptionQueue;
  readonly describer: DropDescriber;
  readonly versions: Pick<ScriptVersions, 'frozen'>;
  readonly scratchDir: string;
  readonly room: ScratchRoom;
}

/** The day's AI budget spent: asked again each hour, so it resumes once the day turns, never abandoned (§ 8). */
const BUDGET_DELAY_MS = 60 * 60_000;
/** A machine short of disk takes the medium again this much later (ADR 0070 § 4). */
const SHORT_OF_DISK_DELAY_MS = 15 * 60_000;

export type DescribeOutcome =
  'described' | 'already' | 'off' | 'not_described' | 'gone' | 'unreadable' | 'later';

async function contextOf(deps: DescribeDeps, target: MediaToDescribe): Promise<DropMediaContext> {
  if (target.script === null) return dropContextOf(target.category, null);
  const version = await deps.versions.frozen(target.script.versionId);
  return dropContextOf(
    target.category,
    version === null ? null : { slotKey: target.script.slotKey, segments: version.segments },
  );
}

/**
 * `content_drops.describe_file` (ADR 0083 § 1): a photo or a video she dropped, once kept in her library, is described
 * by the vision AI with what the drop says of it, then kept for the agency to validate. Nothing for a voice note (its
 * transcription is elsewhere), a medium no live drop holds, an original already erased, or a creator whose switch is off
 * (§ 9). Replayable: a medium already described is left alone, and the description is written once.
 */
export async function describeFile(
  deps: DescribeDeps,
  mediaAssetId: string,
  now: Date,
  correlationId: string,
): Promise<DescribeOutcome> {
  const target = await deps.queue.target(mediaAssetId);
  if (target === null || target.erased) return 'gone';
  if (target.kind === 'audio') return 'not_described';
  if (!target.describes) return 'off';
  if (await deps.describer.described(mediaAssetId)) return 'already';

  const later = async (delayMs: number): Promise<'later'> => {
    await deps.queue.later(target.creatorId, mediaAssetId, correlationId, new Date(now.getTime() + delayMs));
    return 'later';
  };
  const release = await deps.room.take(target.bytes);
  if (release === null) return later(SHORT_OF_DISK_DELAY_MS);
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(deps.scratchDir, 'impera-describe-'));
    const path = join(dir, 'media');
    if (!(await deps.storage.download(target.storageKey, path, target.bytes))) return 'gone';
    const outcome = await deps.describer.describe({
      creatorId: target.creatorId,
      mediaAssetId,
      path,
      mime: target.mime,
      kind: target.kind,
      bytes: target.bytes,
      context: await contextOf(deps, target),
    });
    if (outcome === 'budget') return await later(BUDGET_DELAY_MS);
    if (outcome === 'failed') throw new DropDescriptionFailed(`media ${mediaAssetId}: every model failed`);
    return outcome;
  } finally {
    if (dir !== null) await rm(dir, { recursive: true, force: true });
    release();
  }
}
