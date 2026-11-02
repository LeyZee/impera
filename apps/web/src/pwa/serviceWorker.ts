/**
 * The service worker's registration and the « new version » signal (CR-01). The worker installs a new version in the
 * background and waits; the page says so and the person chooses when: never a reload forced in the middle of a shift.
 * Only in a production build: Vite's development server serves its modules itself.
 */

type Listener = () => void;

let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();

function announce(worker: ServiceWorker): void {
  waiting = worker;
  for (const listener of listeners) listener();
}

/** Whether a new version waits for « Mettre à jour ». */
export function updateReady(): boolean {
  return waiting !== null;
}

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let reloading = false;

/** The person's choice: the waiting version takes over, then the page reloads once, on that version. */
export function applyUpdate(): void {
  if (waiting === null || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  waiting.postMessage({ type: 'apply-update' });
}

/** How often an open app asks whether a new version was deployed (and each time it comes back to the foreground). */
const CHECK_EVERY_MS = 30 * 60 * 1000;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        // A version that was already waiting when the page opened (an earlier « Plus tard »).
        if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
          announce(registration.waiting);
        }
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            // The first install has no controller yet: nothing to update, the app simply works offline next time.
            if (worker.state === 'installed' && navigator.serviceWorker.controller !== null) announce(worker);
          });
        });
        const check = (): void => {
          registration.update().catch(() => undefined);
        };
        setInterval(check, CHECK_EVERY_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check();
        });
      })
      .catch(() => {
        // No worker (private window, refused): the app works as a plain web page.
      });
  });
}
