import {
  scriptSlots,
  slotFileRefusal,
  type ContentDrop,
  type FillScriptSlotBody,
  type ScriptDrop,
  type ScriptSlot,
  type StartScriptDropBody,
} from '@impera/contracts';

import {
  ContentDropFormatUnprocessable,
  ContentDropScriptUnprocessable,
  ContentDropSlotNotFound,
} from '../domain/errors';
import type { ScriptDropStore, ScriptVersions, StartedScript } from '../domain/ports';
import { slotOf } from '../domain/script-drops';

export interface ScriptDropDeps {
  readonly store: ScriptDropStore;
  readonly versions: ScriptVersions;
}

/** Her drop and the frozen version it shoots, its slots read from it. */
async function versionOf(deps: ScriptDropDeps, started: StartedScript) {
  const version = await deps.versions.frozen(started.versionId);
  if (version === null) throw new ContentDropScriptUnprocessable();
  return { ...version, slots: scriptSlots(version.segments) };
}

async function shown(deps: ScriptDropDeps, started: StartedScript): Promise<ScriptDrop> {
  const { name, segments } = await versionOf(deps, started);
  return { drop: started.drop, name, segments: [...segments] };
}

/** `POST /creator-space/content/script-drops`: her script begun from her request, empty (SC-02 lot b). */
export async function startScriptDrop(
  deps: ScriptDropDeps,
  userId: string,
  body: StartScriptDropBody,
): Promise<ScriptDrop> {
  return shown(deps, await deps.store.start(userId, body));
}

export async function readScriptDrop(
  deps: ScriptDropDeps,
  userId: string,
  dropId: string,
): Promise<ScriptDrop> {
  return shown(deps, await deps.store.read(userId, dropId));
}

/**
 * A slot filled, or its file replaced: the slot is one of the frozen version's, the file of its kind and within the
 * script's weights (its lengths are read once it is cleaned). The frozen version never changes, so it is read before
 * the store's transaction.
 */
export async function fillScriptSlot(
  deps: ScriptDropDeps,
  userId: string,
  dropId: string,
  slotKey: string,
  file: FillScriptSlotBody,
  now: Date,
): Promise<ContentDrop> {
  const { slots } = await versionOf(deps, await deps.store.read(userId, dropId));
  const slot: ScriptSlot | undefined = slotOf(slots, slotKey);
  if (slot === undefined) throw new ContentDropSlotNotFound();
  const sentence = slotFileRefusal(slot.slot, file);
  if (sentence !== null) throw new ContentDropFormatUnprocessable([{ fileId: file.id, sentence }]);
  return deps.store.fill(userId, dropId, slot, file, now);
}

/** « Envoyer le script »: every slot she may not leave out filled, the drop goes on. */
export async function submitScriptDrop(
  deps: ScriptDropDeps,
  userId: string,
  dropId: string,
  now: Date,
  correlationId: string,
): Promise<ContentDrop> {
  const { slots } = await versionOf(deps, await deps.store.read(userId, dropId));
  return deps.store.submit(userId, dropId, slots, now, correlationId);
}
