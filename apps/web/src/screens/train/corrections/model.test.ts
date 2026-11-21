import { describe, expect, it } from 'vitest';

import { correctionsHeadline, reasonColours, wordDiff } from './model';

const items = (n: number): readonly never[] => new Array<never>(n);

describe('Entraîner › Corrections in figures (Design, recette du 21/11)', () => {
  it('gives each reason its colour by rank, folding a fifth into the series’ other ink', () => {
    const colours = reasonColours([
      { reason: 'too_long', count: 1 },
      { reason: 'edited', count: 4 },
      { reason: 'sounds_ai', count: 2 },
      { reason: 'none', count: 1 },
      { reason: 'other', count: 1 },
    ]);
    expect(colours.get('edited')).toBe('var(--nv-series-1)');
    expect(colours.get('sounds_ai')).toBe('var(--nv-series-2)');
    // A tie keeps the view's order.
    expect(colours.get('too_long')).toBe('var(--nv-series-3)');
    expect(colours.get('none')).toBe('var(--nv-series-4)');
    expect(colours.get('other')).toBe('var(--nv-series-other)');
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
