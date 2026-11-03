/**
 * What this device keeps of Impera, forgotten when nobody is signed in any more (CR-01): the service worker's copies
 * of the app (`impera-*` caches) and the device's push subscription. Called at every sign-out and on any 401 of
 * `/v1/me` (a session revoked or expired elsewhere), not only at the button. Never throws: a browser without
 * these features, or one that refuses, simply has nothing to forget.
 */
export async function forgetDevice(): Promise<void> {
  await Promise.all([dropCaches(), dropPushSubscription()]);
}

/** The prefixes of the app's copies, the one from before the rename included (`public/sw.js` keeps the same list). */
const PREFIXES = ['impera-', 'nirvana-']; // ADR 0062

async function dropCaches(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => PREFIXES.some((prefix) => key.startsWith(prefix)))
        .map((key) => caches.delete(key)),
    );
  } catch {
    // Storage blocked: nothing was kept either.
  }
}

async function dropPushSubscription(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // No push here, or the browser refused: the server drops dead subscriptions on its own.
  }
}
