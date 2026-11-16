import { describe, expect, it } from 'vitest';

import { fanNotesOf } from '../jobs/respond';

describe('her notes about the fan, split by who reads them (ADR 0085 § 9)', () => {
  it('gives the brain alone when he has money, his attachment and his moods', () => {
    const { notes, brainNotes } = fanNotesOf([
      { category: 'identity', key: 'first_name', value: 'Hugo' },
      { category: 'commercial', key: 'payday', value: 'le 5 du mois' },
      { category: 'life', key: 'Attachment', value: 'jaloux' },
      { category: 'life', key: 'moods', value: 'seul le soir' },
      // A chatter's note stays everyone's, whatever its key.
      { category: 'operator_note', key: 'payday', value: 'attend sa paie' },
    ]);
    expect(notes).toEqual(['first_name : Hugo', 'Note : attend sa paie']);
    expect(brainNotes).toEqual(['payday : le 5 du mois', 'Attachment : jaloux', 'moods : seul le soir']);
  });

  it('reads his age on the card, the youngest when several are active (recette AGE-13)', () => {
    expect(fanNotesOf([{ category: 'identity', key: 'age', value: '17' }]).cardAge).toBe(17);
    expect(
      fanNotesOf([
        { category: 'identity', key: 'age', value: '25 ans' },
        { category: 'identity', key: 'age', value: '16' },
      ]).cardAge,
    ).toBe(16);
    expect(fanNotesOf([{ category: 'identity', key: 'age', value: 'la trentaine' }]).cardAge).toBeUndefined();
    expect(fanNotesOf([{ category: 'operator_note', key: 'note', value: '17' }]).cardAge).toBeUndefined();
  });

  it('says whether his card age was noted, or stated with proof, never only guessed (Charles, 16/11)', () => {
    const history = [
      { id: 'm1', author: 'fan', text: 'J’ai 31 ans et toi ?' },
      { id: 'm2', author: 'fan', text: 'Devine' },
      { id: 'm3', author: 'ai', text: 'J’ai 31 ans aussi' },
      { id: 'm4', author: 'fan', text: 'J’ai 31 ans, enfin dans 2 ans' },
    ];
    const age = (kind: string, confidence = 0.9, sourceMessageId: string | null = 'm1') =>
      fanNotesOf(
        [{ category: 'identity', key: 'age', value: '31', kind, confidence, sourceMessageId }],
        history,
      );
    expect(age('declared')).toMatchObject({ cardAge: 31, cardAgeStated: true });
    expect(age('noted', 1, null)).toMatchObject({ cardAge: 31, cardAgeStated: true });
    expect(age('inferred')).toMatchObject({ cardAge: 31, cardAgeStated: false });
  });

  it('a declared card age confirms only with the direct path’s proof (relecture Sécurité, #798)', () => {
    const history = [
      { id: 'm1', author: 'fan', text: 'J’ai 31 ans et toi ?' },
      { id: 'm2', author: 'fan', text: 'Devine' },
      { id: 'm3', author: 'ai', text: 'J’ai 31 ans aussi' },
      { id: 'm4', author: 'fan', text: 'J’ai 31 ans, enfin dans 2 ans' },
    ];
    const stated = (confidence: number, sourceMessageId: string | null, read = history) =>
      fanNotesOf(
        [{ category: 'identity', key: 'age', value: '31', kind: 'declared', confidence, sourceMessageId }],
        read,
      ).cardAgeStated;
    expect(stated(0.5, 'm1')).toBe(false);
    expect(stated(0.9, null)).toBe(false);
    expect(stated(0.9, 'm2')).toBe(false);
    expect(stated(0.9, 'm3')).toBe(false);
    expect(stated(0.9, 'm4')).toBe(false);
    expect(stated(0.9, 'm1', [])).toBe(false);
    expect(
      fanNotesOf([{ category: 'identity', key: 'age', value: '31', kind: 'declared' }]).cardAgeStated,
    ).toBe(false);
  });
});
