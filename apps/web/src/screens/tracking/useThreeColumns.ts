import { useSyncExternalStore } from 'react';

/**
 * A screen wide enough for Suivi in three columns (Charles, 08/11): the list, the conversation, and what is known of
 * the fan always in view beside it. Narrower, his sheet stays a folded band above the thread.
 */
export const THREE_COLUMNS = '(min-width: 1320px)';

const query = (): MediaQueryList | null =>
  typeof matchMedia === 'function' ? matchMedia(THREE_COLUMNS) : null;

function subscribe(listener: () => void): () => void {
  const list = query();
  list?.addEventListener('change', listener);
  return () => {
    list?.removeEventListener('change', listener);
  };
}

export const useThreeColumns = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
