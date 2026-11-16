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
});
