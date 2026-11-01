import type { CreatorSummary } from '@nirvana/contracts';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * The creator the agent's screens follow: the Dashboard and its mode control, the bar's pill and Suivi's « À traiter »
 * all read the same one. Chosen on the Dashboard when the account sees several creators, and kept on the device: the
 * pill sits on every screen, so the choice outlives a change of page and a reload. Without a choice, or once the
 * chosen creator is no longer listed, the first of the list.
 */

const KEY = 'nirvana.followed-creator';

/** Where the choice lives when the browser refuses its storage (private window, blocked site data). */
let memory: { readonly id: string } | null = null;
const listeners = new Set<() => void>();

function stored(): string | null {
  if (memory !== null) return memory.id;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Follows `creatorId` from now on, on every screen that reads it. */
export function followCreator(creatorId: string): void {
  try {
    localStorage.setItem(KEY, creatorId);
    memory = null;
  } catch {
    // Refused: the choice stays in memory for this tab.
    memory = { id: creatorId };
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab chose: this one follows too.
  const onStorage = (event: StorageEvent): void => {
    if (event.key === KEY) listener();
  };
  addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener('storage', onStorage);
  };
}

/** The creator chosen among `creators`, or the first when none is chosen or the chosen one is gone. */
export function followedOf(
  creators: readonly CreatorSummary[],
  chosen: string | null,
): CreatorSummary | undefined {
  return creators.find((creator) => creator.id === chosen) ?? creators[0];
}

/** The chosen creator's id as stored, and the way to choose another. */
export function useFollowedCreatorId(): {
  readonly chosen: string | null;
  readonly follow: (creatorId: string) => void;
} {
  const chosen = useSyncExternalStore(subscribe, stored, () => null);
  const follow = useCallback((creatorId: string) => {
    followCreator(creatorId);
  }, []);
  return { chosen, follow };
}
