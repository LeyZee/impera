import type { CreatorSummary } from '@impera/contracts';
import { useCallback, useSyncExternalStore } from 'react';

import { followCreator } from './followed';

/**
 * The creator the menu's selector is set on (ADR 0134 § 3): one creator, or « Toutes » for the agency's views. The
 * Dashboard, Suivi, Fans and Créatrices read the same one, and it is kept on the device, so the choice outlives a
 * change of page and a reload. An address that names a creator wins and sets it. Choosing a creator also makes her the
 * one followed (`followed.ts`: the bar's pill, the mode control); « Toutes » leaves the one followed as it is.
 */

const KEY = 'impera.creator-scope';
/** What is stored for « Toutes »: never a creator's id. */
const ALL = 'all';

/** Where the choice lives when the browser refuses its storage (private window, blocked site data). */
let memory: { readonly value: string } | null = null;
const listeners = new Set<() => void>();

function stored(): string | null {
  const value = memory === null ? read() : memory.value;
  return value === null || value === ALL ? null : value;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Sets the selector on `creatorId`, or on « Toutes » with `null`, for every screen that reads it. */
export function scopeTo(creatorId: string | null): void {
  const value = creatorId ?? ALL;
  // Already there: nothing to write, nobody to wake.
  if ((memory === null ? read() : memory.value) === value) return;
  try {
    localStorage.setItem(KEY, value);
    memory = null;
  } catch {
    // Refused: the choice stays in memory for this tab.
    memory = { value };
  }
  if (creatorId !== null) followCreator(creatorId);
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

/** The creator of `creators` the selector is set on, or `null` for « Toutes » and for one no longer listed. */
export function scopedOf(creators: readonly CreatorSummary[], chosen: string | null): CreatorSummary | null {
  return creators.find((creator) => creator.id === chosen) ?? null;
}

/** The id the selector is set on as stored (`null` for « Toutes »), and the way to set it. */
export function useCreatorScope(): {
  readonly chosen: string | null;
  readonly choose: (creatorId: string | null) => void;
} {
  const chosen = useSyncExternalStore(subscribe, stored, () => null);
  const choose = useCallback((creatorId: string | null) => {
    scopeTo(creatorId);
  }, []);
  return { chosen, choose };
}
