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
  respondWith: (response: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
}

function loadWorker(network: (url: string) => Promise<Response>): {
  fire: (
    type: string,
    event: Partial<FakeEvent>,
  ) => { answered: Promise<Response> | null; work: Promise<unknown>[] };
  stored: Map<string, Map<string, Response>>;
  skipWaiting: ReturnType<typeof vi.fn>;
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
  const self = {
    location: { origin: 'https://crm.test' },
    clients: { claim: () => Promise.resolve() },
    skipWaiting,
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
  };
  const fetchFake = (request: { url: string }): Promise<Response> => network(request.url);
  runInNewContext(swSource, { self, caches, fetch: fetchFake, URL, Promise, Math });

  return {
    stored,
    skipWaiting,
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
    worker.stored.set('nirvana-shell-v0', new Map());
    worker.stored.set('someone-else', new Map());
    await Promise.all(worker.fire('install', {}).work);
    await Promise.all(worker.fire('activate', {}).work);
    expect([...worker.stored.keys()].sort()).toEqual(['nirvana-shell-v1', 'someone-else']);
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
});
