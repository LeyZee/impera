import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import manifestText from '../../public/manifest.webmanifest?raw';
import swSource from '../../public/sw.js?raw';

/**
 * The service worker (public/sw.js) runs in a fake worker scope: what it answers, what it keeps, and above all that it
 * never touches the API (/v1/), where every account's data lives.
 */

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  request?: { method: string; url: string; mode: string };
  data?: unknown;
  notification?: { data: unknown; close: () => void };
  respondWith: (response: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
}

interface FakeWindow {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

/** An open window of the app; `answers` says whether its page moves itself when told (src/pwa/notificationOpen.ts). */
function openWindowOf(answers: boolean): FakeWindow {
  return {
    url: 'https://crm.test/suivi',
    focus: vi.fn(() => Promise.resolve()),
    navigate: vi.fn(() => Promise.resolve()),
    postMessage: vi.fn((_message: unknown, ports: MessagePort[]) => {
      if (answers) ports[0]?.postMessage('opened');
    }),
  };
}

function loadWorker(network: (url: string) => Promise<Response>): {
  fire: (
    type: string,
    event: Partial<FakeEvent>,
  ) => { answered: Promise<Response> | null; work: Promise<unknown>[] };
  stored: Map<string, Map<string, Response>>;
  skipWaiting: ReturnType<typeof vi.fn>;
  showNotification: ReturnType<typeof vi.fn>;
  windows: FakeWindow[];
  openWindow: ReturnType<typeof vi.fn>;
} {
  const listeners = new Map<string, Listener>();
  const stored = new Map<string, Map<string, Response>>();
  const keyOf = (request: string | { url: string }): string =>
    new URL(typeof request === 'string' ? request : request.url, 'https://crm.test').pathname;
  const open = (name: string): Map<string, Response> => {
    const cache = stored.get(name) ?? new Map<string, Response>();
    stored.set(name, cache);
    return cache;
  };
  const caches = {
    open: (name: string) => {
      const cache = open(name);
      return Promise.resolve({
        addAll: (paths: string[]) => {
          for (const path of paths) cache.set(path, new Response(path));
          return Promise.resolve();
        },
        put: (request: string | { url: string }, response: Response) => {
          cache.set(keyOf(request), response);
          return Promise.resolve();
        },
        match: (request: string | { url: string }) => Promise.resolve(cache.get(keyOf(request))),
        keys: () => Promise.resolve([...cache.keys()].map((path) => ({ url: `https://crm.test${path}` }))),
        delete: (request: { url: string }) => Promise.resolve(cache.delete(keyOf(request))),
      });
    },
    match: (request: string, options: { cacheName: string }) =>
      Promise.resolve(stored.get(options.cacheName)?.get(keyOf(request))),
    keys: () => Promise.resolve([...stored.keys()]),
    delete: (name: string) => Promise.resolve(stored.delete(name)),
  };
  const skipWaiting = vi.fn();
  const showNotification = vi.fn(() => Promise.resolve());
  const windows: FakeWindow[] = [];
  const openWindow = vi.fn(() => Promise.resolve(null));
  const self = {
    location: { origin: 'https://crm.test' },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow,
    },
    registration: { showNotification },
    skipWaiting,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  const fetchFake = (request: { url: string }): Promise<Response> => network(request.url);
  runInNewContext(swSource, {
    self,
    caches,
    fetch: fetchFake,
    URL,
    Promise,
    Math,
    MessageChannel,
    setTimeout,
    clearTimeout,
  });

  return {
    stored,
    skipWaiting,
    showNotification,
    windows,
    openWindow,
    fire: (type, partial) => {
      let answered: Promise<Response> | null = null;
      const work: Promise<unknown>[] = [];
      listeners.get(type)?.({
        ...partial,
        respondWith: (response) => {
          answered = response;
        },
        waitUntil: (promise) => work.push(promise),
      });
      return { answered, work };
    },
  };
}

function ok(body: string): Response {
  // A same-origin answer: `type` is 'basic', as the browser gives it.
  const response = new Response(body, { status: 200 });
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

const get = (path: string, mode = 'no-cors') => ({ method: 'GET', url: `https://crm.test${path}`, mode });

describe('service worker', () => {
  it('never answers nor keeps anything of the API', () => {
    const network = vi.fn((url: string) => Promise.resolve(ok(url)));
    const worker = loadWorker(network);
    for (const path of ['/v1', '/v1/me', '/v1/conversations?limit=20']) {
      expect(worker.fire('fetch', { request: get(path) }).answered).toBeNull();
    }
    expect(worker.fire('fetch', { request: { ...get('/v1/me'), method: 'POST' } }).answered).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it('leaves other sites alone', () => {
    const worker = loadWorker((url) => Promise.resolve(ok(url)));
    const request = { method: 'GET', url: 'https://fonts.example/font.woff2', mode: 'cors' };
    expect(worker.fire('fetch', { request }).answered).toBeNull();
  });

  it('opens the app without a network from the last copy of the page', async () => {
    let online = true;
    const worker = loadWorker((url) =>
      online ? Promise.resolve(ok(`page ${url}`)) : Promise.reject(new Error('offline')),
    );
    const first = worker.fire('fetch', { request: get('/suivi', 'navigate') }).answered;
    expect(await (await first)?.text()).toBe('page https://crm.test/suivi');
    online = false;
    const offline = worker.fire('fetch', { request: get('/paie', 'navigate') }).answered;
    expect(await (await offline)?.text()).toBe('page https://crm.test/suivi');
  });

  it('serves a hashed file from its copy once fetched', async () => {
    const network = vi.fn((url: string) => Promise.resolve(ok(url)));
    const worker = loadWorker(network);
    await worker.fire('fetch', { request: get('/assets/index-abc123.js') }).answered;
    const again = await worker.fire('fetch', { request: get('/assets/index-abc123.js') }).answered;
    expect(await again?.text()).toBe('https://crm.test/assets/index-abc123.js');
    expect(network).toHaveBeenCalledOnce();
  });

  it('drops the copies of an older version when it takes over, and only on « Mettre à jour »', async () => {
    const worker = loadWorker((url) => Promise.resolve(ok(url)));
    worker.stored.set('impera-shell-v0', new Map());
    worker.stored.set('someone-else', new Map());
    await Promise.all(worker.fire('install', {}).work);
    await Promise.all(worker.fire('activate', {}).work);
    expect([...worker.stored.keys()].sort()).toEqual(['impera-shell-v2', 'someone-else']);
    worker.fire('message', { data: { type: 'something' } });
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    worker.fire('message', { data: { type: 'apply-update' } });
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it('keeps every file of the shell that the manifest and the page name', () => {
    const manifest: unknown = JSON.parse(manifestText);
    expect(manifest).toMatchObject({ start_url: '/', scope: '/', display: 'standalone', lang: 'fr' });
    for (const path of ['/', '/appearance.js', '/manifest.webmanifest', '/icons/icon-192.png']) {
      expect(swSource).toContain(`'${path}'`);
    }
  });

  it('shows a pushed message with the app’s icon, cut to size, and rings plain « Impera » on anything odd', async () => {
    const worker = loadWorker((url) => Promise.resolve(ok(url)));
    const push = (value: unknown, raw = false) =>
      Promise.all(
        worker.fire('push', {
          data: {
            json: () => {
              if (raw) throw new SyntaxError('not JSON');
              return value;
            },
          },
        }).work,
      );
    await push({ title: 'Nouvelle vente', body: 'x'.repeat(400), url: '/suivi', tag: 'sale' });
    expect(worker.showNotification).toHaveBeenLastCalledWith('Nouvelle vente', {
      body: 'x'.repeat(180),
      tag: 'sale',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      lang: 'fr',
      data: { url: '/suivi' },
    });
    await push(null, true);
    expect(worker.showNotification).toHaveBeenLastCalledWith(
      'Impera',
      expect.objectContaining({ data: { url: '/' } }),
    );
  });

  it('opens only a page of the app from a notification, never another site', async () => {
    const worker = loadWorker((url) => Promise.resolve(ok(url)));
    const touch = (url: unknown) =>
      Promise.all(worker.fire('notificationclick', { notification: { data: { url }, close: vi.fn() } }).work);
    for (const evil of [
      'https://evil.example/',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
    ]) {
      await touch(evil);
      expect(worker.openWindow).toHaveBeenLastCalledWith('/');
    }
    await touch('/planning');
    expect(worker.openWindow).toHaveBeenLastCalledWith('/planning');
  });

  it('brings the open app forward and lets it move to the page itself, without a reload', async () => {
    const worker = loadWorker((url) => Promise.resolve(ok(url)));
    const open = openWindowOf(true);
    worker.windows.push(open);
    await Promise.all(
      worker.fire('notificationclick', { notification: { data: { url: '/commissions' }, close: vi.fn() } })
        .work,
    );
    expect(open.focus).toHaveBeenCalledOnce();
    // The message comes from the worker's own realm: compared field by field.
    expect(open.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open', path: '/commissions' }),
      expect.anything(),
    );
    expect(open.navigate).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it('loads the page in the open window only when it does not answer', async () => {
    vi.useFakeTimers();
    try {
      const worker = loadWorker((url) => Promise.resolve(ok(url)));
      const open = openWindowOf(false);
      worker.windows.push(open);
      const done = Promise.all(
        worker.fire('notificationclick', { notification: { data: { url: '/planning' }, close: vi.fn() } })
          .work,
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(open.navigate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(600);
      await done;
      expect(open.navigate).toHaveBeenCalledWith('/planning');
      expect(worker.openWindow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays quiet when the window refuses to load the page (a window it does not control)', async () => {
    vi.useFakeTimers();
    try {
      const worker = loadWorker((url) => Promise.resolve(ok(url)));
      const open = openWindowOf(false);
      open.navigate.mockRejectedValue(new TypeError('not controlled'));
      worker.windows.push(open);
      const done = Promise.all(
        worker.fire('notificationclick', { notification: { data: { url: '/planning' }, close: vi.fn() } })
          .work,
      );
      await vi.advanceTimersByTimeAsync(1600);
      await expect(done).resolves.toBeDefined();
      expect(open.focus).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
