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

  it('drops the copies of the app and the push subscription, and nothing that is not Impera’s', async () => {
    const { deleted } = fakeCaches(['impera-shell-v1', 'impera-assets-v1', 'nirvana-shell-v2', 'other-site']); // ADR 0062
    const unsubscribe = vi.fn(() => Promise.resolve(true));
    fakePush({ unsubscribe });
    await forgetDevice();
    expect(deleted).toEqual(['impera-shell-v1', 'impera-assets-v1', 'nirvana-shell-v2']); // ADR 0062
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('drops her agenda and her session kept for offline, and nothing else (CREA-04)', async () => {
    localStorage.setItem('impera.agenda.pending', '[]');
    localStorage.setItem('impera.session.me', '{}');
    localStorage.setItem('impera.appearance', 'night');
    await forgetDevice();
    expect(localStorage.getItem('impera.agenda.pending')).toBeNull();
    expect(localStorage.getItem('impera.session.me')).toBeNull();
    expect(localStorage.getItem('impera.appearance')).toBe('night');
    localStorage.clear();
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
