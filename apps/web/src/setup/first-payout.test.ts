import { TeamMemberIdSchema, type MemberSetup } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { firstPayoutGaps, gapCount, PAYOUT_MISSING } from './first-payout';

const BASILE = TeamMemberIdSchema.parse('00000000-0000-4000-8000-0000000000b1');
const CELIA = TeamMemberIdSchema.parse('00000000-0000-4000-8000-0000000000c1');
const MANAGER = TeamMemberIdSchema.parse('00000000-0000-4000-8000-0000000000d1');
const NAMES: Record<string, string> = { [BASILE]: 'Basile', [CELIA]: 'Célia', [MANAGER]: 'Dorian' };
const nameOf = (id: string): string => NAMES[id] ?? '?';

const paid = (
  memberId: MemberSetup['memberId'],
  reasons: MemberSetup['steps'][number]['note'],
): MemberSetup => ({
  memberId,
  teamRole: 'chatter',
  steps: [
    { key: 'invitation', state: 'done', note: null },
    { key: 'billing', state: reasons === null ? 'done' : 'todo', note: reasons },
  ],
});

describe('« Avant ton premier versement » (recette PARC-01)', () => {
  it('says the agency’s gaps once, then every gap of each member at once, his empty « Où te verser » with them', () => {
    const gaps = firstPayoutGaps(
      [
        paid(BASILE, {
          kind: 'billing',
          reason: 'agency_missing',
          reasons: [
            'agency_missing',
            'mandate_unpublished',
            'no_regime',
            'identity_unverified',
            'prefix_missing',
          ],
        }),
        paid(CELIA, { kind: 'billing', reason: 'mandate_unpublished', reasons: ['mandate_unpublished'] }),
        // Not paid: no « Facturation » step, nothing to say of him.
        { memberId: MANAGER, teamRole: 'manager', steps: [{ key: 'invitation', state: 'done', note: null }] },
      ],
      [
        { memberId: BASILE, method: null, changedAt: null },
        { memberId: CELIA, method: 'mobile_money', changedAt: '2026-11-20T10:00:00.000Z' },
        { memberId: MANAGER, method: null, changedAt: null },
      ],
      nameOf,
    );
    expect(gaps).toEqual({
      agency: ['L’identité de l’agence n’est pas remplie', 'Le mandat de facturation n’est pas publié'],
      members: [
        {
          memberId: BASILE,
          name: 'Basile',
          gaps: [
            'Aucun régime de facturation donné',
            'Identité à vérifier par toi',
            'Préfixe de factures à poser',
            PAYOUT_MISSING,
          ],
        },
      ],
    });
    expect(gapCount(gaps)).toBe(6);
  });

  it('says his mandate not accepted once it is published, never « not published » (recette PARC-05)', () => {
    const gaps = firstPayoutGaps(
      [paid(CELIA, { kind: 'billing', reason: 'no_mandate', reasons: ['no_mandate'] })],
      null,
      nameOf,
    );
    expect(gaps.agency).toEqual([]);
    expect(gaps.members[0]?.gaps).toEqual([
      'Mandat de facturation pas encore accepté (par lui, dans Moi › Dossier)',
    ]);
  });

  it('is empty once all is settled, and says no empty « Où te verser » before the list is read', () => {
    const gaps = firstPayoutGaps([paid(BASILE, null)], null, nameOf);
    expect(gaps).toEqual({ agency: [], members: [] });
    expect(gapCount(gaps)).toBe(0);
  });
});
