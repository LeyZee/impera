import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import earlyScript from '../../public/appearance.js?raw';
import { INSTALL_REFUSALS_KEY } from '../pwa/install';

import { APPEARANCE_KEY } from './appearance';

/** The prefix of the keys before the rename. */
const OLD = 'nirvana'; // ADR 0062

/** Runs `public/appearance.js` as the browser does, on a device that kept `stored`; returns what it keeps after. */
function firstLoad(stored: Record<string, string>): { kept: Map<string, string>; theme: string | undefined } {
  const kept = new Map(Object.entries(stored));
  const root: { dataset: { theme?: string } } = { dataset: {} };
  runInNewContext(earlyScript, {
    localStorage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => kept.set(key, value),
      removeItem: (key: string) => kept.delete(key),
    },
    matchMedia: () => ({ matches: false }),
    document: { documentElement: root, querySelector: () => null },
  });
  return { kept, theme: root.dataset.theme };
}

describe('the choices kept before the rename (ADR 0062)', () => {
  it('come over under the new names on the first load, and the old names go', () => {
    const { kept, theme } = firstLoad({
      [`${OLD}.appearance`]: 'day',
      [`${OLD}.followed-creator`]: 'creator-1',
      [`${OLD}.suivi.order`]: 'desire',
      [`${OLD}.install.refusals`]: '2',
      'someone-else': 'x',
    });
    expect(Object.fromEntries(kept)).toEqual({
      [APPEARANCE_KEY]: 'day',
      'impera.followed-creator': 'creator-1',
      'impera.suivi.order': 'desire',
      [INSTALL_REFUSALS_KEY]: '2',
      'someone-else': 'x',
    });
    // The theme read just after is already the carried one: no first load in the wrong theme.
    expect(theme).toBe('light');
  });

  it('never overwrite a choice made under the new name', () => {
    const { kept } = firstLoad({ [`${OLD}.appearance`]: 'day', [APPEARANCE_KEY]: 'night' });
    expect(Object.fromEntries(kept)).toEqual({ [APPEARANCE_KEY]: 'night' });
  });

  it('leave a device that kept nothing as it is', () => {
    expect(firstLoad({}).kept.size).toBe(0);
  });
});
