// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PUSH_KEY_URL,
  PUSH_SUBSCRIPTIONS_URL,
  pushState,
  refreshPushSubscription,
  turnOffPush,
  turnOnPush,
} from './push';

/** Keys of the right size, made of one repeated byte: shapes the contract accepts, nothing secret. */
const filled = (length: number, byte: number): string =>
  btoa(String.fromCharCode(...new Uint8Array(length).fill(byte)))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
const SERVER_KEY = filled(65, 4);
const OTHER_KEY = filled(65, 9);
const DEVICE_SHARED = filled(16, 7);
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';

const bytes = (value: string): ArrayBuffer => {
  const binary = atob(
    value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
};

function fakeSubscription(key: string) {
  return {
    endpoint: ENDPOINT,
    options: { applicationServerKey: bytes(key) },
    toJSON: () => ({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: OTHER_KEY, auth: DEVICE_SHARED },
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

interface Setup {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  existing?: ReturnType<typeof fakeSubscription> | null;
  userAgent?: string;
}

function setUp({ permission = 'default', answer = 'granted', existing = null, userAgent }: Setup = {}) {
  let subscription = existing;
  const requestPermission = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission, requestPermission }));
  vi.stubGlobal('PushManager', vi.fn());
  const pushManager = {
    getSubscription: () => Promise.resolve(subscription),
    subscribe: vi.fn((options: { applicationServerKey: Uint8Array }) => {
      subscription = fakeSubscription(
        btoa(String.fromCharCode(...options.applicationServerKey))
          .replace(/\+/gu, '-')
          .replace(/\//gu, '_')
          .replace(/=+$/u, ''),
      );
      return Promise.resolve(subscription);
    }),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: () => Promise.resolve({ pushManager }),
      ready: Promise.resolve({ pushManager }),
    },
  });
  if (userAgent !== undefined) vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  const calls: { url: string; method: string; body: unknown }[] = [];
  const order: string[] = [];
  requestPermission.mockImplementation(() => {
    order.push('ask');
    return Promise.resolve(answer);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      order.push(`${method} ${url}`);
      calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      if (url === PUSH_KEY_URL)
        return Promise.resolve(new Response(JSON.stringify({ publicKey: SERVER_KEY })));
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  return { requestPermission, pushManager, calls, order };
}

describe('push on this device', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('sends an iPhone in Safari to the install guide first: notifications need the installed app', async () => {
    setUp({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' });
    expect(await pushState()).toBe('needs_install');
    expect(await turnOnPush()).toBe('needs_install');
  });

  it('reads the server’s key before asking, then subscribes and tells the server', async () => {
    const { order, calls } = setUp();
    expect(await pushState()).toBe('off');
    expect(await turnOnPush()).toBe('on');
    expect(order).toEqual([`GET ${PUSH_KEY_URL}`, 'ask', `PUT ${PUSH_SUBSCRIPTIONS_URL}`]);
    expect(calls.at(-1)?.body).toMatchObject({ endpoint: ENDPOINT });
    expect(await pushState()).toBe('on');
  });

  it('never asks when the server’s key cannot be read: iOS asks only once', async () => {
    const { requestPermission } = setUp();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
    );
    expect(await turnOnPush()).toBe('failed');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('says when the person refused, and does not ask again', async () => {
    setUp({ answer: 'denied' });
    expect(await turnOnPush()).toBe('denied');
    const { requestPermission } = setUp({ permission: 'denied' });
    expect(await turnOnPush()).toBe('denied');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('subscribes again at opening when the server’s key was renewed', async () => {
    const old = fakeSubscription(OTHER_KEY);
    const { pushManager } = setUp({ permission: 'granted', existing: old });
    await refreshPushSubscription();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it('only tells the server again when the key is the same', async () => {
    const same = fakeSubscription(SERVER_KEY);
    const { pushManager, calls } = setUp({ permission: 'granted', existing: same });
    await refreshPushSubscription();
    expect(same.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.at(-1)?.method).toBe('PUT');
  });

  it('makes the server forget this device, then the browser', async () => {
    const existing = fakeSubscription(SERVER_KEY);
    const { calls } = setUp({ permission: 'granted', existing });
    await turnOffPush();
    expect(calls).toEqual([{ url: PUSH_SUBSCRIPTIONS_URL, method: 'DELETE', body: { endpoint: ENDPOINT } }]);
    expect(existing.unsubscribe).toHaveBeenCalledOnce();
  });
});
