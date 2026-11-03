import type { TeamMember } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { paperworkLines } from './paperwork';

import { documentOf } from '@/test/contractors';
import { invoiceOf, LOU, OCT2, THEO } from '@/test/pay';

const pendingDoc = (n: number, member: TeamMember) => ({
  ...documentOf(n, { memberId: member.id, review: null, remindFrom: null }),
  displayName: member.displayName,
});

describe('the invoices’ card of the owner’s Dashboard', () => {
  it('says nothing while nothing waits', () => {
    expect(paperworkLines([], [], null)).toEqual([]);
    expect(paperworkLines([], [], { documents: [], more: false })).toEqual([]);
  });

  it('puts the late invoices first in red, then the near ones and the contests in amber', () => {
    const lines = paperworkLines(
      [{ due: 'soon' }, { due: 'overdue' }, { due: 'soon' }],
      [
        invoiceOf(1, LOU, OCT2, {
          acceptance: {
            state: 'contested',
            deadline: '2026-11-09T22:59:00.000Z',
            reason: 'Un rapport manque.',
          },
        }),
      ],
      null,
    );
    expect(lines.map((line) => [line.tone, line.text])).toEqual([
      ['danger', '1 facture en retard : l’échéance est passée sans règlement.'],
      ['warn', '2 factures arrivent à échéance dans les sept jours.'],
      ['warn', '1 contestation à trancher.'],
    ]);
  });

  it('names each member whose documents wait, once, and says when more wait', () => {
    const [line] = paperworkLines([], [], {
      documents: [pendingDoc(1, THEO), pendingDoc(2, LOU), pendingDoc(3, THEO)],
      more: true,
    });
    expect(line).toEqual({
      kind: 'documents',
      tone: 'neutral',
      text: 'Plus de 3 pièces à examiner :',
      members: [
        { memberId: THEO.id, name: 'Théo' },
        { memberId: LOU.id, name: 'Lou' },
      ],
      more: true,
    });
  });
});
