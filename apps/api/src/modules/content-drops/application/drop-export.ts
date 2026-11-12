import { Readable } from 'node:stream';

import { dropExportPlan, dropFitsInOneArchive } from '../domain/drop-export';
import { ContentDropExportUnprocessable } from '../domain/errors';
import type { AgencyContentStore, DropStorage } from '../domain/ports';

import { archiveChunks, type ScriptArchive } from './script-export';

export interface DropExportDeps {
  readonly agency: AgencyContentStore;
  readonly storage: DropStorage;
}

/**
 * `GET /creators/:creatorId/drops/:id/export` (recette créatrice 1): any drop of hers but a script as a ZIP, its
 * sheet first, then its media in her order, for the team that puts it out by hand (ADR 0044). Every refusal comes
 * before the first byte.
 */
export async function exportDrop(
  deps: DropExportDeps,
  creatorId: string,
  userId: string,
  dropId: string,
  now: Date,
): Promise<ScriptArchive> {
  const sent = await deps.agency.sentDrop(creatorId, userId, dropId);
  if (!dropFitsInOneArchive(sent.files)) throw new ContentDropExportUnprocessable('too_large');
  const plan = dropExportPlan(sent);
  return {
    fileName: `${plan.folder}.zip`,
    stream: Readable.from(
      archiveChunks(deps.storage, { path: plan.sheetPath, text: plan.sheet }, plan.entries, now),
    ),
  };
}
