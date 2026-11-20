import type { VaultChoicesChange, VaultFolderView, VaultMediaView } from '@impera/contracts';

import { choiceOf, folderCount, type ChoiceIndex } from './choice';
import { folderName } from './model';

/*
 * « Choisir dans Reveal » (ADR 0145 § 5, avenant du 20/11): what the last sync read of her vault, folder by folder, and
 * what the owner wants in Impera. Nothing is written while she ticks: a draft, sent whole by « Importer ». Pure rules
 * here, so that the window only lays them out and the tests read them.
 */

/** What a folder would hold in Impera: all of it (and what Reveal adds later), none, or these media only. */
export type FolderPick =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'some'; readonly ids: ReadonlySet<string> };

/** The owner's ticks not yet sent, by folder (`account:folderRef`); a folder not in it stays as it is. */
export type PickDraft = ReadonlyMap<string, FolderPick>;

export const pickKey = (folder: Pick<VaultFolderView, 'platformAccountId' | 'folderRef'>): string =>
  `${folder.platformAccountId}:${folder.folderRef ?? ''}`;

const listedIds = (folder: VaultFolderView): string[] =>
  folder.media.filter((each) => !each.removed).map((each) => each.platformMediaId);

/** Where a folder stands in Impera today, read from the choices. */
export function currentPick(index: ChoiceIndex, folder: VaultFolderView): FolderPick {
  const count = folderCount(index, folder);
  if (count.tick === 'all') return { kind: 'all' };
  if (count.tick === 'none') return { kind: 'none' };
  return {
    kind: 'some',
    ids: new Set(
      folder.media
        .filter((each) => !each.removed && choiceOf(index, folder, each).imported)
        .map((each) => each.platformMediaId),
    ),
  };
}

/** The pick the window shows for a folder: the draft's, else today's. */
export const pickOf = (draft: PickDraft, index: ChoiceIndex, folder: VaultFolderView): FolderPick =>
  draft.get(pickKey(folder)) ?? currentPick(index, folder);

/** The media a pick takes, among those Reveal still lists. */
export function pickedIds(pick: FolderPick, folder: VaultFolderView): ReadonlySet<string> {
  if (pick.kind === 'all') return new Set(listedIds(folder));
  if (pick.kind === 'none') return new Set();
  return pick.ids;
}

/** A set of media said as a pick: none, all of them, or these. An empty folder ticked stays « all ». */
function normalised(ids: ReadonlySet<string>, folder: VaultFolderView): FolderPick {
  const listed = listedIds(folder);
  if (ids.size === 0) return { kind: 'none' };
  if (listed.every((id) => ids.has(id))) return { kind: 'all' };
  return { kind: 'some', ids };
}

const same = (a: FolderPick, b: FolderPick): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'some' || b.kind !== 'some') return true;
  return a.ids.size === b.ids.size && [...a.ids].every((id) => b.ids.has(id));
};

/** The draft with this folder's pick; a pick back to today's leaves the draft. */
function withPick(
  draft: PickDraft,
  index: ChoiceIndex,
  folder: VaultFolderView,
  pick: FolderPick,
): PickDraft {
  const next = new Map(draft);
  if (same(pick, currentPick(index, folder))) next.delete(pickKey(folder));
  else next.set(pickKey(folder), pick);
  return next;
}

/** A folder's card ticked: all of it when it was not whole, none when it was. */
export function folderToggled(draft: PickDraft, index: ChoiceIndex, folder: VaultFolderView): PickDraft {
  const pick = pickOf(draft, index, folder);
  return withPick(draft, index, folder, pick.kind === 'all' ? { kind: 'none' } : { kind: 'all' });
}

/** One media ticked or unticked inside a folder. */
export function mediaToggled(
  draft: PickDraft,
  index: ChoiceIndex,
  folder: VaultFolderView,
  id: string,
): PickDraft {
  const ids = new Set(pickedIds(pickOf(draft, index, folder), folder));
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return withPick(draft, index, folder, normalised(ids, folder));
}

/** « Tout cocher » in a folder: the whole folder; again, nothing. */
export function folderFilled(draft: PickDraft, index: ChoiceIndex, folder: VaultFolderView): PickDraft {
  return folderToggled(draft, index, folder);
}

/** What « Importer » would change: media that enter Impera, and media that leave it. */
export interface DraftSummary {
  readonly mediaIn: number;
  readonly mediaOut: number;
}

export function draftSummary(
  draft: PickDraft,
  index: ChoiceIndex,
  folders: readonly VaultFolderView[],
): DraftSummary {
  let mediaIn = 0;
  let mediaOut = 0;
  for (const folder of folders) {
    const pick = draft.get(pickKey(folder));
    if (pick === undefined) continue;
    const before = pickedIds(currentPick(index, folder), folder);
    const after = pickedIds(pick, folder);
    mediaIn += [...after].filter((id) => !before.has(id)).length;
    mediaOut += [...before].filter((id) => !after.has(id)).length;
  }
  return { mediaIn, mediaOut };
}

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString('fr-FR')} ${count === 1 ? one : many}`;

/**
 * The window's foot, what is ticked and not yet sent, by folder: « 2 dossiers cochés », « 1 dossier décoché », both;
 * `null` when nothing waits. The count of media is the button's.
 */
export function draftLine(draft: PickDraft): string | null {
  const picks = [...draft.values()];
  const on = picks.filter((pick) => pick.kind !== 'none').length;
  const off = picks.length - on;
  const parts = [
    on > 0 ? plural(on, 'dossier coché', 'dossiers cochés') : null,
    off > 0 ? plural(off, 'dossier décoché', 'dossiers décochés') : null,
  ].filter((each) => each !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The window's button: what it does, said with its count. */
export function applyLabel(summary: DraftSummary): string {
  if (summary.mediaOut === 0) return `Importer ${plural(summary.mediaIn, 'média', 'médias')}`;
  if (summary.mediaIn === 0) return `Retirer ${plural(summary.mediaOut, 'média', 'médias')}`;
  return `Importer ${plural(summary.mediaIn, 'média', 'médias')}, retirer ${String(summary.mediaOut)}`;
}

/** What the window just did, said under the vault's head once it closes. */
export function appliedLine(summary: DraftSummary): string {
  const into =
    summary.mediaIn === 0
      ? null
      : `${plural(summary.mediaIn, 'média importé', 'médias importés')}. Pour les faire décrire, ouvre un dossier et sélectionne-les.`;
  const out =
    summary.mediaOut === 0 ? null : `${plural(summary.mediaOut, 'média retiré', 'médias retirés')} d’Impera.`;
  return [into, out].filter((each) => each !== null).join(' ') || 'Rien n’a changé.';
}

/** At most this many media in one request (the contract's bound). */
const AT_ONCE = 500;

/**
 * The draft as the requests that write it, one account each, its media in turns of `AT_ONCE`. A folder whole is one
 * tick; a folder in part is its tick taken off (its media's own ticks go) and then its media ticked one by one.
 */
export function draftChanges(draft: PickDraft, folders: readonly VaultFolderView[]): VaultChoicesChange[] {
  const byAccount = new Map<
    VaultFolderView['platformAccountId'],
    { folders: VaultChoicesChange['folders']; media: string[] }
  >();
  for (const folder of folders) {
    const pick = draft.get(pickKey(folder));
    if (pick === undefined) continue;
    const account = byAccount.get(folder.platformAccountId) ?? { folders: [], media: [] };
    account.folders.push({ folderRef: folder.folderRef, imported: pick.kind === 'all' });
    if (pick.kind === 'some') account.media.push(...pickedIds(pick, folder));
    byAccount.set(folder.platformAccountId, account);
  }
  const changes: VaultChoicesChange[] = [];
  for (const [platformAccountId, account] of byAccount) {
    changes.push({
      platformAccountId,
      folders: account.folders,
      media: account.media.slice(0, AT_ONCE).map((platformMediaId) => ({ platformMediaId, imported: true })),
    });
    for (let at = AT_ONCE; at < account.media.length; at += AT_ONCE)
      changes.push({
        platformAccountId,
        folders: [],
        media: account.media
          .slice(at, at + AT_ONCE)
          .map((platformMediaId) => ({ platformMediaId, imported: true })),
      });
  }
  return changes;
}

/** A folder's name in the window: the vault's root says what it holds. */
export const pickerFolderName = (folder: Pick<VaultFolderView, 'folderName' | 'folderRef'>): string =>
  folder.folderRef === null ? 'Médias hors dossier' : folderName(folder);

/** How a card says where its folder stands in Impera, `null` when nothing of it is. */
export function inImperaLine(pick: FolderPick, folder: VaultFolderView): string | null {
  const listed = listedIds(folder).length;
  if (pick.kind === 'none') return null;
  if (pick.kind === 'all') return 'Dans Impera';
  return `${pick.ids.size.toLocaleString('fr-FR')} sur ${listed.toLocaleString('fr-FR')} dans Impera`;
}

/** How many media of a folder the window shows at first, then by as many again: a root of thousands stays light. */
export const PICKER_PAGE = 120;

/** The media a folder open in the window shows: still listed by Reveal, in its order. */
export const pickerMedia = (folder: VaultFolderView): VaultMediaView[] =>
  folder.media.filter((each) => !each.removed);
