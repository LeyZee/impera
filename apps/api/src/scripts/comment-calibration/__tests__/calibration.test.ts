import { describe, expect, it } from 'vitest';

import {
  blindLines,
  CorpusLineSchema,
  pairOfCorpusLine,
  setAside,
  shapeOf,
  type CalibrationPair,
} from '../calibration';

/* Invented pairs (ADR 0010). */
const pairs: CalibrationPair[] = Array.from({ length: 10 }, (_, index) => ({
  comment: `Commentaire ${String(index)}`,
  reply: `Réponse ${String(index)}`,
  mediaKind: 'reel',
  caption: '',
}));

describe('the calibration of her replies to comments (Charles, 26/11)', () => {
  it('reads a line of her corpus, handles removed, her first reply kept', () => {
    const line = CorpusLineSchema.parse({
      id: 'P0042',
      date: '2025-03-14',
      support: 'Photo ou carrousel',
      publication: 'Dimanche @amie',
      commentaire: '@elle trop belle',
      reponses: [
        { date: '2025-03-14', destinataire: 'quelquun', texte: '@quelquun Merciii 🫶🏻' },
        { date: '2025-03-15', destinataire: 'quelquun', texte: 'Encore merci' },
      ],
    });
    expect(pairOfCorpusLine(line)).toEqual({
      comment: 'trop belle',
      reply: 'Merciii 🫶🏻',
      mediaKind: 'photo',
      caption: 'Dimanche',
    });
    expect(pairOfCorpusLine({ ...line, commentaire: '@elle' })).toBeNull();
    expect(CorpusLineSchema.safeParse({ ...line, extra: 1 }).success).toBe(false);
  });

  it('sets aside the same pairs for the same seed, never one in both halves', () => {
    const first = setAside(pairs, 3, 7);
    expect(setAside(pairs, 3, 7)).toEqual(first);
    expect(first.test).toHaveLength(3);
    expect(first.bank).toHaveLength(7);
    for (const pair of first.test) expect(first.bank).not.toContainEqual(pair);
    expect(setAside(pairs, 3, 8).test).not.toEqual(first.test);
  });

  it('says the shape of replies in numbers, without a word of them', () => {
    const shape = shapeOf(['Merci 🫶🏻', 'Vraiment ? 😏😏', 'haha !', 'Oui']);
    expect(shape).toEqual({
      replies: 4,
      medianChars: 6,
      emojis: { none: 0.5, one: 0.25, two: 0.25, more: 0 },
      withQuestion: 0.25,
      withExclamation: 0.25,
      startsUppercase: 0.75,
    });
    expect(JSON.stringify(shape)).not.toContain('Merci');
  });

  it('puts hers as A or B by a draw, about half each, and keeps which in the key', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      comment: `C${String(index)}`,
      hers: `H${String(index)}`,
      model: `M${String(index)}`,
    }));
    const lines = blindLines(rows, 3);
    for (const line of lines) expect(line.hers === 'A' ? line.a : line.b).toMatch(/^H/u);
    expect(lines.filter((line) => line.hers === 'A')).toHaveLength(10);
  });
});
