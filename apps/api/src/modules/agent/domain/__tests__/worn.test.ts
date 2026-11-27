import { describe, expect, it } from 'vitest';

import {
  checkWorn,
  DEFAULT_WORN_LIMITS,
  WORN_MIN_CONVERSATIONS,
  wornPhrases,
  type HerRecentMessage,
} from '../worn';

// Invented lines of hers to several fans (ADR 0010): the same anecdote and closing question again and again.
const texts = [
  'Tranquille, un verre de vin avec Churro sous les toits',
  'Pas grand-chose, un verre de vin et une série',
  'Je me pose avec un verre de vin 😌 et toi ta soirée ?',
  'Je rentre de la salsa, et toi ta soirée ?',
  'Un verre de vin, Churro sur les genoux',
  'Crevée, et toi ta soirée ?',
  'Churro dort déjà 😅 et toi ta soirée ?',
  'Ah bon ? Churro aussi adore ça',
];
/** Each line to another fan, by turns among four. */
const toFans = (lines: readonly string[]): HerRecentMessage[] =>
  lines.map((text, i) => ({ conversationId: `fan-${String(i % 4)}`, text }));
const lately = toFans(texts);

describe('wornPhrases (passe 2 du 26/11)', () => {
  it('names the anecdotes and closing questions in too many of her recent messages', () => {
    const worn = wornPhrases(lately);
    expect(worn).toContain('un verre de');
    expect(worn).toContain('churro');
    expect(worn.some((phrase) => phrase.includes('toi ta soiree'))).toBe(true);
  });

  it('names nothing under the limits, nor a run of words that carry nothing', () => {
    expect(wornPhrases(lately.slice(0, 2))).toEqual([]);
    expect(wornPhrases(toFans(Array.from({ length: 10 }, () => 'je sais pas toi')))).toEqual([]);
  });

  it('reads only her last messages, within the window', () => {
    const old = toFans([...Array.from({ length: DEFAULT_WORN_LIMITS.window }, () => 'Coucou'), ...texts]);
    expect(wornPhrases(old)).toEqual([]);
  });

  it('follows a creator’s own limits', () => {
    expect(wornPhrases(lately.slice(0, 3), { window: 10, maxUses: 2 })).toContain('un verre de');
  });

  it('never wears what she repeats to one fan alone: his first name, his town (Sécurité 27/11)', () => {
    const toOne = Array.from({ length: 10 }, (_, i) => ({
      conversationId: 'fan-alone',
      text: `Bonne nuit mon Baptistin, tu dors à Montauban ${String(i)}`,
    }));
    const worn = wornPhrases(toOne);
    expect(worn).toEqual([]);
    // To two fans: still not enough.
    const toTwo = toOne.map((message, i) => ({ ...message, conversationId: `fan-${String(i % 2)}` }));
    expect(wornPhrases(toTwo)).toEqual([]);
  });

  it(`wears a motif once it came back to ${String(WORN_MIN_CONVERSATIONS)} different fans`, () => {
    const toThree = [
      { conversationId: 'fan-a', text: 'Je suis là, Churro ronronne' },
      { conversationId: 'fan-b', text: 'Pas grand-chose, Churro dort' },
      { conversationId: 'fan-c', text: 'Ah, Churro réclame à manger' },
      { conversationId: 'fan-a', text: 'Bisous, Churro te salue' },
    ];
    expect(wornPhrases(toThree)).toContain('churro');
    expect(wornPhrases(toThree.slice(0, 2))).toEqual([]);
  });
});

describe('checkWorn', () => {
  it('warns, soft, on a bubble that says a worn phrase again', () => {
    expect(checkWorn(['Moi ? un verre de vin 😌'], ['un verre de'])).toEqual([
      { code: 'repetition', severity: 'soft', bubbleIndex: 0, match: 'un verre de' },
    ]);
    expect(checkWorn(['Ça va', 'Churro te dit coucou'], ['churro'])).toMatchObject([{ bubbleIndex: 1 }]);
  });

  it('lets other words pass, a part of a word included', () => {
    expect(checkWorn(['Je rentre du ciné'], ['un verre de', 'churro'])).toEqual([]);
    expect(checkWorn(['des churros au marché'], ['churro'])).toEqual([]);
    expect(checkWorn(['Un verre de vin'], [])).toEqual([]);
  });
});
