import { useSyncExternalStore } from 'react';

/** A phone's width (the one `agency.css` folds at): three months then read a column a week. */
const NARROW = '(max-width: 720px)';

const query = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia(NARROW) : null);

function subscribe(listener: () => void): () => void {
  const list = query();
  list?.addEventListener('change', listener);
  return () => {
    list?.removeEventListener('change', listener);
  };
}

export const useNarrow = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
