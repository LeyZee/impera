import type {
  PreparedScriptMoment,
  VaultChoicesView,
  VaultFolderView,
  VaultMediaView,
  VaultView,
} from '@impera/contracts';

import { choiceIndex, choiceOf } from '@/creators/vault/choice';
import { folderName } from '@/creators/vault/model';

/**
 * Her vault as the editor reads it (ADR 0145 § 5, ADR 0149 § 1): a media by the platform's id, where it is, and whether
 * a script can sell it. Only a media imported into the CRM and described is offered: the agent knows what it sells
 * without seeing the picture.
 */
export interface EditorMedia {
  readonly media: VaultMediaView;
  readonly folder: string;
  readonly folderKey: string;
  readonly imported: boolean;
  readonly described: boolean;
  /** The beginning of its description, plain text; `null` while it has none. */
  readonly excerpt: string | null;
}

const keyOf = (folder: VaultFolderView): string => `${folder.platformAccountId}:${folder.folderRef ?? ''}`;

export function editorMedia(
  vault: VaultView | undefined,
  choices: VaultChoicesView | undefined,
): ReadonlyMap<string, EditorMedia> {
  const index = choiceIndex(choices);
  const all = new Map<string, EditorMedia>();
  for (const folder of vault?.folders ?? [])
    for (const media of folder.media) {
      const choice = choiceOf(index, folder, media);
      all.set(media.platformMediaId, {
        media,
        folder: folderName(folder),
        folderKey: keyOf(folder),
        imported: choice.imported,
        described: choice.description === 'described',
        excerpt: choice.excerpt,
      });
    }
  return all;
}

/** A media a branch can take: listed by her vault, imported, described, a photo or a video. */
export const sellable = (item: EditorMedia): boolean =>
  item.imported && item.described && !item.media.removed && item.media.kind !== 'audio';

/** One of her folders as the picker's chips show it. */
export interface PickerFolder {
  readonly key: string;
  readonly name: string;
  readonly moment: VaultFolderView['moment'];
}

/** Her folders in the vault's order, for the picker's chips: key, name and moment. */
export function pickerFolders(vault: VaultView | undefined): readonly PickerFolder[] {
  return (vault?.folders ?? [])
    .filter((folder) => folder.media.length > 0)
    .map((folder) => ({ key: keyOf(folder), name: folderName(folder), moment: folder.moment }));
}

/**
 * The folder the picker opens on (PRO1-11): the first with a media in Impera and of the script's moment, else the first
 * with a media in Impera, else the first. A script of both moments takes either.
 */
export function startFolder(
  folders: readonly PickerFolder[],
  media: ReadonlyMap<string, EditorMedia>,
  moment: PreparedScriptMoment,
): string {
  const withImported = new Set(
    [...media.values()].filter((item) => item.imported).map((item) => item.folderKey),
  );
  const imported = folders.filter((folder) => withImported.has(folder.key));
  const fits = imported.find((folder) => moment === 'both' || folder.moment === moment);
  return (fits ?? imported[0] ?? folders[0])?.key ?? '';
}

/** The accounts a new script can be written for: those her vault was read from. */
export function vaultAccounts(vault: VaultView | undefined): readonly VaultFolderView['platformAccountId'][] {
  return [...new Set((vault?.folders ?? []).map((folder) => folder.platformAccountId))];
}
