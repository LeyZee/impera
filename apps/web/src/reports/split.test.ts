import { describe, expect, it } from 'vitest';

import { waitingSplit } from './model';

import { PAST, sent, WAITING, WITHIN } from '@/test/reports';

const NOW = new Date('2026-11-27T12:00:00Z');

describe('why the counts of Équipe › Rapports differ (recette MAN-09)', () => {
  it('says nothing when every waiting report is the reader’s and goes in the lot', () => {
    expect(waitingSplit([sent(WITHIN), sent(null)], new Set(), NOW)).toBeNull();
  });

  it('splits the reader’s between « Tout valider » and the gaps, then says his own and those waiting', () => {
    const own = { ...sent(null), canReview: false };
    const reports = [
      sent(null),
      sent(WITHIN),
      sent(PAST),
      own,
      { ...sent(null), canReview: false },
      sent(WAITING),
    ];
    expect(waitingSplit(reports, new Set(), NOW)).toBe(
      '3 pour toi : 2 dans « Tout valider », 1 écart à relire · 2 sont les tiens, un autre membre les valide · 1 écart attend l’explication de son membre',
    );
  });

  it('leaves out a report being validated, and says one own report in the singular', () => {
    const held = sent(null);
    expect(
      waitingSplit(
        [held, sent(PAST), sent(PAST), { ...sent(null), canReview: false }],
        new Set([held.id]),
        NOW,
      ),
    ).toBe('2 écarts pour toi, à relire un par un · 1 est le tien, un autre membre le valide');
  });
});
