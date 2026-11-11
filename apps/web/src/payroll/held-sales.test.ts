import { describe, expect, it } from 'vitest';

import {
  decisionText,
  heldCountText,
  heldInOrder,
  heldReasonText,
  outcomeLabel,
  outcomeWords,
  ownLineText,
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
      'Son chatteur sur Reveal n’est relié à aucun membre : relie-le dans Équipe › Reveal et la vente compte seule. Sinon, écarte-la.',
    );
    expect(heldReasonText(unlinked, null, false)).toBe(
      'Son chatteur sur Reveal n’est relié à aucun membre : le propriétaire ou un manager le relie dans Équipe › Reveal. Sinon, écarte-la.',
    );
    expect(heldReasonText(heldSaleOf({ reason: 'status_unknown' }), THEO, true)).toBe(
      'Reveal lui donne un statut qu’Impera ne connaît pas encore.',
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

  it('says a decision on a refund line of the refund, its sale moving with it when the register pays it', () => {
    const refund = (patch: Parameters<typeof heldSaleOf>[0] = {}) =>
      heldSaleOf({ event: 'refund', occurredAt: '2026-10-30T09:15:00.000Z', netMinor: -4_200, ...patch });
    expect(decisionText(refund({ decision: 'count' }), THEO)).toBe('Compté pour Théo');
    expect(decisionText(refund({ decision: 'count' }), null)).toBe('Compté');
    expect(decisionText(refund({ decision: 'exclude' }), THEO)).toBe('Écarté');
    expect(ownLineText(refund())).toBe('C’est un remboursement de ton chatteur : un autre membre en décide.');
    expect(ownLineText(heldSaleOf())).toBe('C’est une vente de ton chatteur : un autre membre en décide.');

    expect(outcomeWords('count', refund(), THEO)).toEqual({
      title: 'Compter ce remboursement pour Théo ?',
      lead: 'Sa vente va sur son relevé, et le remboursement s’en déduit. Tu peux retirer la décision tant qu’aucune clôture n’a compté sa vente.',
      confirm: 'Compter pour Théo',
    });
    expect(outcomeWords('exclude', refund(), THEO)).toEqual({
      title: 'Écarter ce remboursement ?',
      lead: 'Il ne se déduira des ventes de personne, et sa vente ne comptera pour personne non plus. Tu peux retirer la décision tant qu’aucune clôture n’a compté sa vente.',
      confirm: 'Écarter',
    });
    // Its sale older than the register, or paid on the reports: the refund alone.
    expect(
      outcomeWords(
        'exclude',
        refund({ saleOccurredAt: null, salePeriod: null, reason: 'refund_before_register' }),
        null,
      ).lead,
    ).toBe(
      'Il ne se déduira des ventes de personne. Tu peux retirer la décision tant qu’aucune clôture ne l’a compté.',
    );
    expect(outcomeWords('exclude', refund({ reason: 'refund_before_base' }), THEO).lead).toBe(
      'Il ne se déduira des ventes de personne. Tu peux retirer la décision tant qu’aucune clôture ne l’a compté.',
    );
    expect(outcomeWords('withdraw', refund({ decision: 'count' }), THEO).lead).toBe(
      'Le remboursement suit de nouveau les règles : il attend une décision et ne se déduit des ventes de personne.',
    );
    expect(outcomeWords('withdraw', refund({ reason: null, decision: 'exclude' }), THEO).lead).toBe(
      'Le remboursement suit de nouveau les règles : il se déduit des ventes de Théo.',
    );
    const unlinked = refund({ memberId: null, reason: 'chatter_unlinked', outcomes: ['exclude'] });
    expect(heldReasonText(unlinked, null, true)).toBe(
      'Son chatteur sur Reveal n’est relié à aucun membre : relie-le dans Équipe › Reveal et le remboursement se déduit seul. Sinon, écarte-le.',
    );
    expect(heldReasonText(unlinked, null, false)).toBe(
      'Son chatteur sur Reveal n’est relié à aucun membre : le propriétaire ou un manager le relie dans Équipe › Reveal. Sinon, écarte-le.',
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

describe('heldInOrder', () => {
  it('reads the lines by their own instant, the oldest first, whatever their keys', () => {
    const at = (platformSaleId: string, occurredAt: string) => ({
      platformSaleId,
      occurredAt,
      event: 'sale' as const,
    });
    const sorted = heldInOrder([
      at('A', '2026-10-28T14:30:00.000Z'),
      at('B', '2026-10-16T06:00:00.000Z'),
      at('C', '2026-10-28T14:30:00.000Z'),
    ]);
    expect(sorted.map((one) => one.platformSaleId)).toEqual(['B', 'A', 'C']);
  });
});
