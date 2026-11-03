import { describe, expect, it } from 'vitest';

import { creatorNotesOf } from '../creator-notes';

describe('creatorNotesOf (CR-02)', () => {
  it('keeps only what the fan said himself, out of the chatters’ notes and his buying profile', () => {
    expect(
      creatorNotesOf([
        { category: 'life', kind: 'declared', value: 'Infirmier de nuit' },
        { category: 'interests', kind: 'inferred', value: 'Aime sans doute la randonnée' },
        { category: 'operator_note', kind: 'declared', value: 'Relancer jeudi, il paie en fin de mois' },
        { category: 'commercial', kind: 'declared', value: 'Achète les packs à 20 €' },
        { category: 'identity', kind: 'declared', value: '' },
        { category: 'events', kind: 'declared', value: 'Anniversaire le 12' },
      ]),
    ).toEqual(['Infirmier de nuit', 'Anniversaire le 12']);
  });
});
