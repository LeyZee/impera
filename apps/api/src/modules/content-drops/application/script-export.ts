import { Readable } from 'node:stream';

import { Zip, ZipPassThrough } from 'fflate';

import {
  ContentDropCardNotFound,
  ContentDropExportUnprocessable,
  ContentDropStorageUnavailable,
} from '../domain/errors';
import type { AgencyContentStore, DropStorage, ScriptVersions } from '../domain/ports';
import { scriptExportPlan, type ScriptExportPlan } from '../domain/script-export';

export interface ScriptExportDeps {
  readonly agency: AgencyContentStore;
  readonly versions: ScriptVersions;
  readonly storage: DropStorage;
}

/** The archive as the route sends it: its name, and its bytes as they are zipped. */
export interface ScriptArchive {
  readonly fileName: string;
  readonly stream: Readable;
}

/**
 * The archive's bytes, pulled by the response: the sheet first, then each card and each medium in the script's
 * order, stored as they are (`ZipPassThrough`: a photo or a video is compressed already). A medium is read from the
 * storage as it goes out, never held whole: the heaviest video is 10 Gio. A medium the storage no longer has once
 * the archive has begun cuts it, and the agency asks for it again.
 */
async function* archiveChunks(
  deps: ScriptExportDeps,
  versionId: string,
  plan: ScriptExportPlan,
  now: Date,
): AsyncGenerator<Uint8Array> {
  const ready: Uint8Array[] = [];
  const zipping: { failure: Error | null } = { failure: null };
  const zip = new Zip((error, chunk) => {
    if (error === null) ready.push(chunk);
    else zipping.failure = error;
  });
  const open = (path: string): ZipPassThrough => {
    const entry = new ZipPassThrough(path);
    entry.mtime = now;
    zip.add(entry);
    return entry;
  };
  const drained = function* (): Generator<Uint8Array> {
    if (zipping.failure !== null) throw zipping.failure;
    yield* ready.splice(0);
  };

  open(plan.sheetPath).push(new TextEncoder().encode(plan.sheet), true);
  yield* drained();
  for (const { path, source } of plan.entries) {
    if (source.kind === 'card') {
      const png = await deps.versions.folderCard(versionId, source.segmentKey, source.variant);
      if (png === null) throw new ContentDropCardNotFound();
      open(path).push(png, true);
      yield* drained();
      continue;
    }
    const bytes = await deps.storage.read(source.storageKey, source.bytes);
    if (bytes === null)
      throw new ContentDropStorageUnavailable(`${source.storageKey} is gone from the storage`);
    const entry = open(path);
    for await (const chunk of bytes) {
      entry.push(chunk, false);
      yield* drained();
    }
    entry.push(new Uint8Array(0), true);
    yield* drained();
  }
  zip.end();
  yield* drained();
}

/**
 * `GET /creators/:creatorId/drops/:id/script-export` (SC-03 c, ADR 0056 § 7): a sent script's folder as a ZIP, named
 * by her script number, in its order, with the sheet the team copies into Reveal. Every refusal comes before the first
 * byte: a structure shot Jour or Nuit as the request says, never guessed for a « both » one.
 */
export async function exportScript(
  deps: ScriptExportDeps,
  creatorId: string,
  userId: string,
  dropId: string,
  now: Date,
): Promise<ScriptArchive> {
  const sent = await deps.agency.sentScript(creatorId, userId, dropId);
  const version = await deps.versions.frozen(sent.versionId);
  if (version === null) throw new ContentDropExportUnprocessable('not_a_script');
  // The request does not say yet which a « both » structure was shot as (question to Charles): refused, not guessed.
  if (version.moment === 'both') throw new ContentDropExportUnprocessable('moment_unknown');
  const plan = scriptExportPlan({
    number: sent.scriptNumber,
    moment: version.moment,
    version,
    files: sent.files,
    // The cards in the folder become a setting per creator, on by default (ADR 0056 § 3): on for now.
    cards: true,
  });
  return {
    fileName: `${plan.folder}.zip`,
    stream: Readable.from(archiveChunks(deps, sent.versionId, plan, now)),
  };
}
