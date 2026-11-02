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

const VERSION = 'v1';
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
