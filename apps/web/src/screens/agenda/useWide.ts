import { useSyncExternalStore } from 'react';

/** A computer's width (the one `.ag-cols` splits at): Semaine as a grid, Mois, the proportional bar of her day. */
const WIDE = '(min-width: 900px)';

const query = (): MediaQueryList | null => (typeof matchMedia === 'function' ? matchMedia(WIDE) : null);

function subscribe(listener: () => void): () => void {
  const list = query();
  list?.addEventListener('change', listener);
  return () => {
    list?.removeEventListener('change', listener);
  };
}

export const useWide = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
