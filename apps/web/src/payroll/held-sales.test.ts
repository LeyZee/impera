import { describe, expect, it } from 'vitest';

import {
  decisionText,
  heldCountText,
  heldReasonText,
  outcomeLabel,
  outcomeWords,
  saleAmount,
  saleWhen,
  signalChipText,
  signalText,
} from './held-sales';

import { heldSaleOf, THEO as THEO_MEMBER } from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;
const plain = (text: string | null): string | null => (text === null ? null : text.replace(NBSP, ' '));
const THEO = { name: 'Théo', own: false };

describe('held sales (CRM-03 lot b4b)', () => {
  it('says when a sale and a refund were made, the refund with its sale', () => {
    expect(plain(saleWhen(heldSaleOf(), 'Europe/Paris'))).toBe('Vente du mercredi 28 octobre à 22 h');
    expect(
      plain(
        saleWhen(
          heldSaleOf({ event: 'refund', occurredAt: '2026-10-30T09:15:00.000Z', netMinor: -4_200 }),
          'Europe/Paris',
        ),
      ),
    ).toBe('Remboursement du vendredi 30 octobre à 10 h 15 de la vente du mercredi 28 octobre à 22 h');
    expect(
      plain(
        saleWhen(
          heldSaleOf({
            event: 'refund',
            occurredAt: '2026-10-30T09:15:00.000Z',
            saleOccurredAt: null,
            salePeriod: null,
            reason: 'refund_before_register',
          }),
          'Europe/Paris',
        ),
      ),
    ).toBe('Remboursement du vendredi 30 octobre à 10 h 15, vente d’avant le registre');
    expect(plain(saleAmount(heldSaleOf({ netMinor: -4_200 })))).toBe('−42,00 €');
  });

  it('says why a line waits, what the owner or a manager can do about it, and nothing for a paid line', () => {
    expect(heldReasonText(heldSaleOf(), THEO, true)).toBe(
      'Théo n’était ni en poste ni dans sa marge d’accès à l’heure de la vente.',
    );
    const unlinked = heldSaleOf({ memberId: null, reason: 'chatter_unlinked', outcomes: ['exclude'] });
    expect(heldReasonText(unlinked, null, true)).toBe(
      'Son chatteur sur Reveal n’est relié à aucun membre : relie-le dans Réglages › Ventes et la vente compte seule. Sinon, écarte-la.',
    );
    expect(heldReasonText(unlinked, null, false)).toBe(
      'Son chatteur sur Reveal n’est relié à aucun membre : le propriétaire le relie dans Réglages › Ventes. Sinon, écarte-la.',
    );
    expect(heldReasonText(heldSaleOf({ reason: 'status_unknown' }), THEO, true)).toBe(
      'Reveal lui donne un statut que Nirvana ne connaît pas encore.',
    );
    expect(heldReasonText(heldSaleOf({ reason: 'refund_before_register' }), THEO, true)).toBe(
      'Remboursement d’une vente plus ancienne que le registre des ventes : il n’est retiré à personne.',
    );
    expect(heldReasonText(heldSaleOf({ reason: 'refund_before_base' }), THEO, true)).toBe(
      'Remboursement d’une vente payée sur les rapports, avant le passage au net : il n’est pas retiré du net.',
    );
    expect(heldReasonText(heldSaleOf({ reason: null }), THEO, true)).toBeNull();
  });

  it('names the decision in force and each gesture, the member a count goes to', () => {
    expect(decisionText(heldSaleOf(), THEO)).toBeNull();
    expect(decisionText(heldSaleOf({ decision: 'count' }), THEO)).toBe('Comptée pour Théo');
    expect(decisionText(heldSaleOf({ decision: 'exclude' }), THEO)).toBe('Écartée');
    expect(outcomeLabel('count', THEO)).toBe('Compter pour Théo');
    expect(outcomeLabel('count', null)).toBe('Compter');
    expect(outcomeLabel('exclude', THEO)).toBe('Écarter');
    expect(outcomeLabel('withdraw', THEO)).toBe('Retirer la décision');
  });

  it('says before a gesture what it does, its refunds with it, and what taking it back does', () => {
    expect(outcomeWords('count', heldSaleOf(), THEO)).toEqual({
      title: 'Compter cette vente pour Théo ?',
      lead: 'Elle va sur son relevé, ses remboursements avec elle. Tu peux retirer la décision tant qu’aucune clôture n’a compté la vente.',
      confirm: 'Compter pour Théo',
    });
    expect(outcomeWords('exclude', heldSaleOf(), THEO).lead).toBe(
      'Elle ne comptera pour personne, ses remboursements non plus. Tu peux retirer la décision tant qu’aucune clôture n’a compté la vente.',
    );
    // Taken back, a line that waited waits again; a paid line excluded counts again for its member.
    expect(outcomeWords('withdraw', heldSaleOf({ decision: 'count' }), THEO).lead).toBe(
      'La vente suit de nouveau les règles : elle attend une décision et ne compte pour personne.',
    );
    expect(outcomeWords('withdraw', heldSaleOf({ reason: null, decision: 'exclude' }), THEO).lead).toBe(
      'La vente suit de nouveau les règles : elle compte pour Théo.',
    );
  });

  it('counts the lines that wait and those decided', () => {
    expect(plain(heldCountText([heldSaleOf()]))).toBe('1 attend une décision');
    expect(plain(heldCountText([heldSaleOf(), heldSaleOf(), heldSaleOf({ decision: 'exclude' })]))).toBe(
      '2 attendent une décision · 1 décidée',
    );
    expect(
      plain(heldCountText([heldSaleOf({ decision: 'count' }), heldSaleOf({ decision: 'exclude' })])),
    ).toBe('2 décidées');
  });

  it('says a paid line its chatter signalled, by name and with their note (CRM-03 lot b4c)', () => {
    const signal = {
      memberId: THEO_MEMBER.id,
      note: 'Vendue pendant le shift de Lou',
      signalledAt: '2026-10-29T08:00:00.000Z',
    };
    expect(signalText(heldSaleOf(), THEO)).toBeNull();
    expect(plain(signalText(heldSaleOf({ reason: null, signal }), THEO))).toBe(
      'Signalée par Théo : ce n’est pas sa vente. « Vendue pendant le shift de Lou »',
    );
    expect(signalText(heldSaleOf({ reason: null, signal: { ...signal, note: null } }), null)).toBe(
      'Signalée par son chatteur : ce n’est pas sa vente.',
    );
    expect(signalChipText(heldSaleOf())).toBe('Signalée');
    const refund = heldSaleOf({
      event: 'refund',
      netMinor: -1_000,
      reason: null,
      signal: { ...signal, note: null },
    });
    expect(signalText(refund, THEO)).toBe('Signalé par Théo : ce n’est pas son remboursement.');
    expect(signalChipText(refund)).toBe('Signalé');
  });
});
