import { useSyncExternalStore } from 'react';

/*
 * Whether this device has a network (CREA-04, CREA-24): what the browser says, kept up to date by its `online` and
 * `offline` events. Only « no network » is sure; a network that says it is there may still not reach the server.
 */

function subscribe(onChange: () => void): () => void {
  addEventListener('online', onChange);
  addEventListener('offline', onChange);
  return () => {
    removeEventListener('online', onChange);
    removeEventListener('offline', onChange);
  };
}

export const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

export const useOnline = (): boolean => useSyncExternalStore(subscribe, isOnline, () => true);
