// Nirvana's service worker (CR-01, ADR 0042 § 8): the app opens without a network, and nothing else.
//
// What it keeps: the page itself (index.html, under '/') and Vite's hashed files under /assets/, nothing more.
// What it never keeps: anything under /v1/ (conversations, fans, sales, money, the session), which goes to the
// network untouched; no IndexedDB either. Since it only holds the app's own files, its cache carries nothing of an
// account, and the page empties it at every sign-out and on any 401 (src/pwa/device.ts).
//
// Updates: a new version installs in the background and waits. The page offers « Mettre à jour » and only then asks
// it to take over (message 'apply-update'): never a reload forced on someone in the middle of a shift.
//
// Served from the root with `Cache-Control: no-cache` (nginx.conf.template, `location /`), never under /assets/,
// so the browser always sees a new version. Hand-written, no build dependency: bump VERSION when this file changes.

const VERSION = 'v2';
const SHELL = `nirvana-shell-${VERSION}`;
const ASSETS = `nirvana-assets-${VERSION}`;
/** Hashed files kept at most: each deployment adds new ones, the oldest go first. */
const MAX_ASSETS = 120;
const SHELL_FILES = ['/', '/appearance.js', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('nirvana-') && key !== SHELL && key !== ASSETS)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'apply-update') self.skipWaiting();
});

// Web Push (CR-01 lot b). The server sends `{ title, body, url, tag }` and never a fan's name nor a message
// (ADR 0020): what rings on a locked screen is read by anyone near the phone.
self.addEventListener('push', (event) => {
  const message = readPush(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      lang: 'fr',
      data: { url: message.url },
    }),
  );
});

/** A message as the server sends it; anything else still rings, as plain « Nirvana ». */
function readPush(data) {
  let value = {};
  try {
    value = data ? data.json() : {};
  } catch {
    value = {};
  }
  const text = (field, max) => (typeof value[field] === 'string' ? value[field].slice(0, max) : undefined);
  return {
    title: text('title', 80) || 'Nirvana',
    body: text('body', 180),
    tag: text('tag', 64),
    url: safePath(value.url),
  };
}

/** Only a path of this app opens: never another site, whatever the message says. */
function safePath(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//') || url.includes('\\'))
    return '/';
  return url;
}

// A touch on the notification brings the app forward on its page, or opens it. An open app moves there itself
// (src/pwa/notificationOpen.ts): no reload, so a message being written is not lost. Loading the page is only the
// fallback, when no window answers within a moment (sign-in screen, an older version of the page).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) {
        await self.clients.openWindow(path);
        return;
      }
      await open.focus().catch(() => undefined);
      if (await movedItself(open, path)) return;
      // Refused on a window this worker does not control: it stays where it is, brought forward.
      if ('navigate' in open) await open.navigate(path).catch(() => undefined);
    })(),
  );
});

/** Whether the window moved to `path` itself: it answers on the port within ANSWER_MS. */
const ANSWER_MS = 1500;
function movedItself(client, path) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const settle = (moved) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(moved);
    };
    const timer = setTimeout(() => settle(false), ANSWER_MS);
    channel.port1.onmessage = () => settle(true);
    client.postMessage({ type: 'open', path }, [channel.port2]);
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The API is never cached, never answered from here: the network or nothing.
  if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request));
    return;
  }
  if (SHELL_FILES.includes(url.pathname)) event.respondWith(shellFile(request, url.pathname));
});

/** The page: the network first (a deployment shows at once), the last copy when the network is gone. */
async function page(request) {
  try {
    const response = await fetch(request);
    // Every path of the app answers the same index.html (nginx `try_files … /index.html`).
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(SHELL);
      await cache.put('/', response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match('/', { cacheName: SHELL });
    if (cached) return cached;
    throw error;
  }
}

/** A hashed file never changes: the copy first, else the network, kept for next time. */
async function asset(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((key) => cache.delete(key)));
  }
  return response;
}

/** The few unhashed files of the shell: the network first, the copy offline. */
async function shellFile(request, path) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(SHELL);
      await cache.put(path, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(path, { cacheName: SHELL });
    if (cached) return cached;
    throw error;
  }
}
