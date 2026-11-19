// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { revealMark } from './reveal-mark';

describe('revealMark', () => {
  it('draws two eyes glancing aside on its tile', () => {
    const mark = revealMark(false);
    expect(mark.getAttribute('viewBox')).toBe('0 0 40 40');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelectorAll('.pp-reveal__white')).toHaveLength(2);
    expect(mark.querySelectorAll('.pp-reveal__pupil')).toHaveLength(2);
    expect(mark.classList.contains('is-reading')).toBe(false);
  });

  it('keeps each pupil inside its eye', () => {
    const mark = revealMark(false);
    const whites = [...mark.querySelectorAll('.pp-reveal__white')];
    const pupils = [...mark.querySelectorAll('.pp-reveal__pupil')];
    pupils.forEach((pupil, index) => {
      const white = whites[index];
      const x = Number(pupil.getAttribute('cx'));
      const r = Number(pupil.getAttribute('r'));
      const cx = Number(white?.getAttribute('cx'));
      const rx = Number(white?.getAttribute('rx'));
      expect(x + r).toBeLessThanOrEqual(cx + rx);
      expect(x - r - 4.6).toBeGreaterThanOrEqual(cx - rx);
    });
  });

  it('reads the tab while a session is on its way', () => {
    expect(revealMark(true).classList.contains('is-reading')).toBe(true);
  });
});
