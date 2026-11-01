import { describe, expect, it } from 'vitest';

import indexHtml from '../../index.html?raw';
import earlyScript from '../../public/appearance.js?raw';

import { APPEARANCE_KEY, isDay, parseAppearance } from './appearance';

describe('appearance', () => {
  it('is Nuit unless Jour or the device was chosen', () => {
    expect(parseAppearance(null)).toBe('night');
    expect(parseAppearance('light')).toBe('night');
    expect(parseAppearance('day')).toBe('day');
    expect(parseAppearance('device')).toBe('device');
  });

  it('shows Jour for Jour, and for the device only when it is light', () => {
    expect(isDay('night', true)).toBe(false);
    expect(isDay('day', false)).toBe(true);
    expect(isDay('device', true)).toBe(true);
    expect(isDay('device', false)).toBe(false);
  });

  it('is applied before the first paint, by a file read with the same key', () => {
    expect(indexHtml).toContain('<script src="/appearance.js"></script>');
    expect(earlyScript).toContain(`localStorage.getItem('${APPEARANCE_KEY}')`);
  });
});
