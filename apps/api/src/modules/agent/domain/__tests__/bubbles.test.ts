import { describe, expect, it } from 'vitest';

import { bubbleBudget, bubbleDelays, fitBubbles } from '../bubbles';

const fan = (text: string) => ({ from: 'fan' as const, text });
const her = (text: string) => ({ from: 'creator' as const, text });

describe('bubbleBudget (Charles 16/11 : « trois rarement », 21/11 : jamais une bulle à chaque fois)', () => {
  it('leaves room for a small laugh bubble after a short message', () => {
    expect(bubbleBudget([her('Coucou'), fan('ça va ?')])).toBe(2);
    expect(bubbleBudget([her('Coucou'), fan('ok'), fan('😂')])).toBe(2);
    expect(bubbleBudget([fan('hey'), fan('t’es là ?'), fan('réponds 😅'), fan('allô')])).toBe(2);
  });

  it('gives two to one long message, three only when he wrote long in two messages or more', () => {
    expect(bubbleBudget([fan('a'.repeat(140))])).toBe(2);
    expect(bubbleBudget([fan('a'.repeat(70)), fan('b'.repeat(70))])).toBe(3);
  });

  it('reads only what he wrote since her last message, and gives one to a follow-up', () => {
    expect(bubbleBudget([fan('un'), fan('deux'), fan('trois'), her('Coucou'), fan('re')])).toBe(2);
    expect(bubbleBudget([fan('salut'), her('Coucou toi')])).toBe(1);
    expect(bubbleBudget([])).toBe(1);
  });

  it('never goes past her own maximum', () => {
    expect(bubbleBudget([fan('ça va ?')], 1)).toBe(1);
    expect(bubbleBudget([fan('a'.repeat(70)), fan('b'.repeat(70))], 2)).toBe(2);
  });
});

describe('fitBubbles', () => {
  it('keeps bubbles within the budget as they are', () => {
    expect(fitBubbles(['a', 'b'], 2)).toEqual(['a', 'b']);
  });

  it('keeps the first bubbles and leaves out what goes past the budget, never gluing them', () => {
    expect(fitBubbles(['Coucou', 'ça va ?', 'moi trop'], 1)).toEqual(['Coucou']);
    expect(fitBubbles(['Coucou', 'ça va ?', 'moi trop'], 2)).toEqual(['Coucou', 'ça va ?']);
  });
});

describe('bubbleDelays', () => {
  it('gives each bubble the time to type it, the first included', () => {
    expect(bubbleDelays(['ok', 'Tu fais quoi ce soir ?'])).toEqual([1_800, 4_800]);
  });

  it('never makes him wait more than 12 s for one bubble', () => {
    expect(bubbleDelays(['a'.repeat(400)])).toEqual([12_000]);
  });

  it('counts an emoji as one character', () => {
    expect(bubbleDelays(['😘'])).toEqual([1_650]);
  });
});
