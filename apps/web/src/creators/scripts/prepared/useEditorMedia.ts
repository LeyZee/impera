import type { CreatorId, VaultView } from '@impera/contracts';
import { useMemo } from 'react';

import { editorMedia, pickerFolders, type EditorMedia } from './media';

import { useVault, useVaultChoices } from '@/creators/vault/api';

/**
 * Her vault as both views of the tab read it (ADR 0149 § 1): each media by the platform's id, and the folders of the
 * picker. Read once by TanStack Query whichever view asks first.
 */
export function useEditorMedia(creatorId: CreatorId): {
  readonly vault: VaultView | undefined;
  readonly media: ReadonlyMap<string, EditorMedia>;
  readonly folders: ReturnType<typeof pickerFolders>;
} {
  const vault = useVault(creatorId, false);
  const choices = useVaultChoices(creatorId, false);
  const media = useMemo(() => editorMedia(vault.data, choices.data), [vault.data, choices.data]);
  const folders = useMemo(() => pickerFolders(vault.data), [vault.data]);
  return { vault: vault.data, media, folders };
}
