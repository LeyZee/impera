import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activeOrigin, ADDRESS_KEY, BUILT_IN_CRM, saveOrigin, storedOrigin } from './crm-origin-store';

/* chrome.storage.local, as a plain map: the store only gets, sets and removes the address. */
const stored = new Map<string, unknown>();
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(stored.has(key) ? { [key]: stored.get(key) } : {}),
        set: (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) stored.set(key, value);
          return Promise.resolve();
        },
        remove: (key: string) => {
          stored.delete(key);
          return Promise.resolve();
        },
      },
    },
  },
}));

const BUILT_IN = 'https://crm.exemple.fr';

beforeEach(() => {
  stored.clear();
});

describe('the address in force (ADR 0067, second amendement)', () => {
  it('has none built in under test or in development', () => {
    expect(BUILT_IN_CRM).toBeNull();
  });

  it('is the saved one, then the built-in one, then none: the welcome', async () => {
    expect(await activeOrigin(null)).toBeNull();
    expect(await storedOrigin(null)).toBe('http://localhost:5173');
    expect(await activeOrigin(BUILT_IN)).toBe(BUILT_IN);
    expect(await storedOrigin(BUILT_IN)).toBe(BUILT_IN);
    stored.set(ADDRESS_KEY, 'https://autre.exemple.fr');
    expect(await activeOrigin(BUILT_IN)).toBe('https://autre.exemple.fr');
  });

  it('never keeps the built-in address as a saved one: saving it brings it back in force', async () => {
    await saveOrigin('https://autre.exemple.fr', BUILT_IN);
    expect(stored.get(ADDRESS_KEY)).toBe('https://autre.exemple.fr');
    await saveOrigin(BUILT_IN, BUILT_IN);
    expect(stored.has(ADDRESS_KEY)).toBe(false);
    expect(await activeOrigin(BUILT_IN)).toBe(BUILT_IN);
  });

  it('saves any address without a built-in one', async () => {
    await saveOrigin(BUILT_IN, null);
    expect(stored.get(ADDRESS_KEY)).toBe(BUILT_IN);
  });
});
