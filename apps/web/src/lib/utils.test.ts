import { describe, expect, it } from 'vitest';

import { cn, deOf, initialOf } from './utils';

describe('cn', () => {
  it('keeps the last conflicting Tailwind utility', () => {
    expect(cn('px-2 text-ink', 'px-4')).toBe('text-ink px-4');
  });
});

describe('initialOf', () => {
  it('takes the first character as seen, never half of an emoji (recette 28/10, M4)', () => {
    expect(initialOf('léa')).toBe('L');
    expect(initialOf('💋 Dashboard-Fan 1')).toBe('💋');
    expect(initialOf('👍🏽 Théo')).toBe('👍🏽');
    expect(initialOf('  ')).toBe('?');
  });
});

describe('deOf', () => {
  it('elides « de » before a vowel, accented or not (recette 05/11, PRO-16)', () => {
    expect(deOf('Anastasia-Maria')).toBe('d’Anastasia-Maria');
    expect(deOf('Émilie')).toBe('d’Émilie');
    expect(deOf('Yvonne')).toBe('d’Yvonne');
    expect(deOf('Yasmine')).toBe('de Yasmine');
    expect(deOf('Léa')).toBe('de Léa');
  });
});
