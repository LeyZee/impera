import {
  BonusIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PenaltyIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type TeamScope,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { redactAuthors, type AuthoredEntries } from '../authors';

import { OWNER, P1, P2 } from './fixtures';

const MANAGER = newId(UserIdSchema);
const member = newId(TeamMemberIdSchema);
const at = '2025-03-20T10:00:00.000Z';

const entries: AuthoredEntries = {
  bonuses: [
    {
      id: newId(BonusIdSchema),
      memberId: member,
      period: P1,
      amountMinor: 3_000,
      reason: 'Renfort du samedi.',
      createdBy: MANAGER,
      createdAt: at,
      cancellation: { cancelledAt: at, cancelledBy: OWNER },
    },
  ],
  penalties: [
    {
      id: newId(PenaltyIdSchema),
      memberId: member,
      fromPeriod: P1,
      toPeriod: P2,
      amount: { kind: 'fixed', amountMinor: 1_500 },
      reason: 'Shift commencé en retard.',
      createdBy: OWNER,
      createdAt: at,
      cancellation: { cancelledAt: at, cancelledBy: MANAGER, cancelledFrom: P2 },
    },
  ],
  adjustments: [
    {
      id: newId(PayAdjustmentIdSchema),
      memberId: member,
      period: P1,
      amountMinor: -1_240,
      reason: 'Rapport compté deux fois.',
      correctsStatementId: null,
      createdBy: MANAGER,
      createdAt: at,
    },
  ],
};

const authorsOf = (scope: TeamScope) => {
  const read = redactAuthors(scope, entries);
  return [
    ...read.bonuses.flatMap((bonus) => [bonus.createdBy, bonus.cancellation?.cancelledBy]),
    ...read.penalties.flatMap((penalty) => [penalty.createdBy, penalty.cancellation?.cancelledBy]),
    ...read.adjustments.map((adjustment) => adjustment.createdBy),
  ];
};

describe('who made an entry, as its reader may see it', () => {
  it('is the agency’s to read: the owner and an active manager see every author', () => {
    for (const scope of ['owner', 'agency'] as const)
      expect(authorsOf(scope)).toEqual([MANAGER, OWNER, OWNER, MANAGER, MANAGER]);
  });

  it('is never a member’s: their entries keep reason, amount and state, their authors at null', () => {
    expect(authorsOf('self')).toEqual([null, null, null, null, null]);
    const read = redactAuthors('self', entries);
    expect(read.bonuses[0]).toMatchObject({ amountMinor: 3_000, cancellation: { cancelledAt: at } });
    expect(read.penalties[0]?.cancellation).toEqual({
      cancelledAt: at,
      cancelledBy: null,
      cancelledFrom: P2,
    });
  });
});
