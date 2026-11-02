// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forgetDevice } from './device';

function fakeCaches(keys: string[]): { deleted: string[] } {
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: () => Promise.resolve(keys),
    delete: (key: string) => {
      deleted.push(key);
      return Promise.resolve(true);
    },
  });
  return { deleted };
}

function fakePush(subscription: { unsubscribe: () => Promise<boolean> } | null): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: () =>
        Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(subscription) } }),
    },
  });
}

describe('forgetDevice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('drops the copies of the app and the push subscription, and nothing that is not Nirvana’s', async () => {
    const { deleted } = fakeCaches(['nirvana-shell-v1', 'nirvana-assets-v1', 'other-site']);
    const unsubscribe = vi.fn(() => Promise.resolve(true));
    fakePush({ unsubscribe });
    await forgetDevice();
    expect(deleted).toEqual(['nirvana-shell-v1', 'nirvana-assets-v1']);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('has nothing to forget on a browser without these features', async () => {
    await expect(forgetDevice()).resolves.toBeUndefined();
  });

  it('never throws when the browser refuses', async () => {
    vi.stubGlobal('caches', { keys: () => Promise.reject(new Error('blocked')) });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: () => Promise.reject(new Error('blocked')) },
    });
    await expect(forgetDevice()).resolves.toBeUndefined();
  });
});
