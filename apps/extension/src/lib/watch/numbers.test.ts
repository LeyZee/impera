import { describe, expect, it } from 'vitest';

import { firstCountIn, parseCount } from './numbers';

describe('parseCount', () => {
  it.each([
    ['0', 0],
    ['842', 842],
    ['1 234', 1234],
    ['1\u00a0234', 1234],
    ['1\u202f234\u202f567', 1_234_567],
    ['1,234', 1234],
    ['1.234', 1234],
    ['12,3 k', 12_300],
    ['12,3\u00a0k', 12_300],
    ['4.5K', 4500],
    ['12 k', 12_000],
    ['1,2 M', 1_200_000],
    ['1,2\u202fM', 1_200_000],
    ['3M', 3_000_000],
    ['2 Md', 2_000_000_000],
    ['1.1B', 1_100_000_000],
    ['  98  ', 98],
  ])('reads « %s » as %d', (text, expected) => {
    expect(parseCount(text)).toBe(expected);
  });

  it.each(['', 'J’aime', '12,34,5', '1 23', 'k', '12 kg', '1,2,3 M', '-4', '12h'])(
    'leaves « %s » unknown',
    (text) => {
      expect(parseCount(text)).toBeNull();
    },
  );

  it('never turns a missing count into 0', () => {
    expect(parseCount(null)).toBeNull();
    expect(parseCount(undefined)).toBeNull();
  });
});

describe('firstCountIn', () => {
  it.each([
    ['1 234 mentions J’aime', 1234],
    ['12,3 k vues', 12_300],
    ['Afficher les 120 commentaires', 120],
    ['View all 1,204 comments', 1204],
    ['1,2 M likes', 1_200_000],
  ])('finds the count in « %s »', (text, expected) => {
    expect(firstCountIn(text)).toBe(expected);
  });

  it('finds nothing in a text without digits', () => {
    expect(firstCountIn('Aimé par atelier.lune')).toBeNull();
  });
});
