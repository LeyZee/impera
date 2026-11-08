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
});
