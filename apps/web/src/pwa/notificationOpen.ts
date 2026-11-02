import { z } from 'zod';

/**
 * A touch on a notification while Nirvana is already open (public/sw.js, `notificationclick`): the service worker
 * hands the page the path, and the page moves there itself, without reloading. A chatter halfway through a message
 * keeps it, as with « Mettre à jour » (the update waits for them, never the other way round).
 *
 * The page answers on the port the worker gave; without that answer (sign-in screen, an older version), the worker
 * falls back to loading the path.
 */

const OpenMessageSchema = z.object({ type: z.literal('open'), path: z.string().max(2048) });

/** Only a path of this app, as the worker checks it too: never another site, whatever the message says. */
export function isAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

/** Listens until the returned function is called; `go` moves the app to the path. */
export function listenForNotificationOpens(go: (path: string) => void): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;
  const container = navigator.serviceWorker;
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (event.origin !== window.location.origin) return;
    const parsed = OpenMessageSchema.safeParse(event.data);
    if (!parsed.success || !isAppPath(parsed.data.path)) return;
    go(parsed.data.path);
    event.ports[0]?.postMessage('opened');
  };
  container.addEventListener('message', onMessage);
  return () => {
    container.removeEventListener('message', onMessage);
  };
}
