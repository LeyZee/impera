import { CreatorIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { audienceOf, readsLine, whenWritten } from './announcements-view';

describe('what an announcement says of itself (EQ-12)', () => {
  it('says whom it is addressed to', () => {
    expect(audienceOf({ creatorId: null, creatorName: null })).toBe('À toute l’équipe');
    expect(
      audienceOf({
        creatorId: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1'),
        creatorName: 'Nora',
      }),
    ).toBe('À l’équipe de Nora');
  });

  it('says how many read it', () => {
    expect(readsLine({ read: 0, of: 0 })).toBe('Personne d’autre dans cette équipe');
    expect(readsLine({ read: 0, of: 1 })).toBe('Pas encore lue · 1 membre');
    expect(readsLine({ read: 0, of: 4 })).toBe('Pas encore lue · 4 membres');
    expect(readsLine({ read: 2, of: 5 })).toBe('Lue par 2 sur 5');
    expect(readsLine({ read: 5, of: 5 })).toBe('Lue par tous · 5');
    expect(readsLine({ read: 1, of: 1 })).toBe('Lue');
  });

  it('says when it was written, in the reader’s zone', () => {
    const plain = (text: string): string => text.replace(/\s/gu, ' ');
    // Paris is UTC+1 after 25/10.
    expect(plain(whenWritten('2026-11-03T12:05:00Z', 'Europe/Paris', '2026-11-03'))).toBe(
      'aujourd’hui, 13 h 05',
    );
    expect(plain(whenWritten('2026-11-02T08:00:00Z', 'Europe/Paris', '2026-11-03'))).toBe('hier, 9 h');
    expect(plain(whenWritten('2026-10-29T08:00:00Z', 'Europe/Paris', '2026-11-03'))).toBe(
      'jeu. 29 oct., 9 h',
    );
  });
});
