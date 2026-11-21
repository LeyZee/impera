import { describe, expect, it } from 'vitest';

import { correctionsHeadline, REASON_COLOURS, wordDiff } from './model';

const items = (n: number): readonly never[] => new Array<never>(n);

describe('Entraîner › Corrections in figures (Design, recette du 21/11)', () => {
  it('gives each reason one colour for good: the four series to the commonest, the other ink to the rest', () => {
    expect(REASON_COLOURS).toEqual({
      edited: 'var(--nv-series-1)',
      sounds_ai: 'var(--nv-series-2)',
      too_long: 'var(--nv-series-3)',
      out_of_character: 'var(--nv-series-4)',
      too_early_sexual: 'var(--nv-series-other)',
      missed_sale: 'var(--nv-series-other)',
      forgot_fact: 'var(--nv-series-other)',
      other: 'var(--nv-series-other)',
      written: 'var(--nv-series-other)',
      none: 'var(--nv-series-other)',
    });
    // Each series tint goes to one reason only.
    const tinted = Object.values(REASON_COLOURS).filter((colour) => colour !== 'var(--nv-series-other)');
    expect(new Set(tinted).size).toBe(tinted.length);
  });

  it('says the answer in a sentence: how many, over how long, and what most were', () => {
    expect(
      correctionsHeadline({
        counts: [
          { reason: 'too_long', count: 2 },
          { reason: 'edited', count: 3 },
        ],
        items: items(5),
      }),
    ).toBe('5 corrections en 30 jours, surtout des retouches');
    expect(
      correctionsHeadline({
        counts: [
          { reason: 'too_long', count: 2 },
          { reason: 'edited', count: 2 },
        ],
        items: items(4),
      }),
    ).toBe('4 corrections en 30 jours');
    expect(correctionsHeadline({ counts: [{ reason: 'sounds_ai', count: 3 }], items: items(3) })).toBe(
      '3 corrections en 30 jours, toutes « Sonne IA »',
    );
    expect(correctionsHeadline({ counts: [{ reason: 'none', count: 1 }], items: items(1) })).toBe(
      '1 correction en 30 jours',
    );
  });

  it('marks the words a retouch took out and those it put in, never a space alone', () => {
    const diff = wordDiff(['Coucou toi, tu fais quoi ce soir ?'], ['Coucou toi 😘 tu fais quoi ?']);
    expect(diff.before).toEqual([
      { text: 'Coucou ', changed: false },
      { text: 'toi,', changed: true },
      { text: ' tu fais quoi ', changed: false },
      { text: 'ce soir', changed: true },
      { text: ' ?', changed: false },
    ]);
    expect(diff.after).toEqual([
      { text: 'Coucou ', changed: false },
      { text: 'toi 😘', changed: true },
      { text: ' tu fais quoi ?', changed: false },
    ]);
    // Joined back, each side reads as it was written, its bubbles on their own lines.
    const two = wordDiff(['Salut', 'ça va ?'], ['Salut', 'ça va ?']);
    expect(two.before.map((p) => p.text).join('')).toBe('Salut\nça va ?');
    expect(two.after.every((p) => !p.changed)).toBe(true);
  });
});
