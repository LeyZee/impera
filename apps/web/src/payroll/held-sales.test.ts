import { TeamImportOverviewSchema, TeamMemberIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  decidedWhyText,
  decisionText,
  giftCountText,
  giveNoteHint,
  giveWords,
  heldCountText,
  heldInOrder,
  heldReasonText,
  lineChatter,
  notePlaceholder,
  outcomeLabel,
  outcomesShown,
  outcomeWords,
  ownLineText,
  partsOf,
  saleAmount,
  saleSellerText,
  saleWhen,
  shareOnStep,
  signalChipText,
  signalText,
} from './held-sales';

import { heldSaleOf, THEO as THEO_MEMBER } from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;
const plain = (text: string | null): string | null => (text === null ? null : text.replace(NBSP, ' '));
const THEO = { name: 'Théo', own: false };
const LEA_ID = TeamMemberIdSchema.parse('01a1d5bf-6bff-7741-9666-f28a3ff884a3');
const nameOf = (memberId: string): string => (memberId === LEA_ID ? 'Léa' : 'Un membre');
const ZONE = 'Europe/Paris';

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

  it('says why a line waits, what the owner or a manager links to count it, and nothing for a paid line', () => {
    expect(heldReasonText(heldSaleOf(), THEO, ZONE)).toBe(
      'Théo n’était ni en poste ni dans sa marge d’accès à l’heure de la vente.',
    );
    const unlinked = heldSaleOf({ memberId: null, reason: 'chatter_unlinked', outcomes: ['exclude'] });
    expect(heldReasonText(unlinked, null, ZONE)).toBe(
      'Son chatteur sur Reveal n’est relié à aucun membre\u00a0: relie-le dans Équipe › Reveal et la vente compte seule. Sinon, écarte-la.',
    );
    expect(heldReasonText(heldSaleOf({ reason: 'status_unknown' }), THEO, ZONE)).toBe(
      'Reveal lui donne un statut qu’Impera ne connaît pas encore.',
    );
    expect(heldReasonText(heldSaleOf({ reason: 'refund_before_register' }), THEO, ZONE)).toBe(
      'Remboursement d’une vente plus ancienne que le registre des ventes : il n’est retiré à personne.',
    );
    expect(heldReasonText(heldSaleOf({ reason: 'refund_before_base' }), THEO, ZONE)).toBe(
      'Remboursement d’une vente payée sur les rapports, avant le passage au net : il n’est pas retiré du net.',
    );
    expect(heldReasonText(heldSaleOf({ reason: null }), THEO, ZONE)).toBeNull();
  });

  it('says the day a member left, and that a sale after it waits for a decision and goes on his final statement (ADR 0072, 11/11)', () => {
    // The sale of the fixture is on Wednesday 28 October at 22 h in Paris.
    expect(heldReasonText(heldSaleOf({ memberLeftOn: '2026-10-26' }), THEO, ZONE)).toBe(
      'Théo a quitté l’équipe le lundi 26 octobre, avant cette vente. Comptée, elle va sur son relevé final, sans minimum de versement.',
    );
    expect(
      heldReasonText(
        heldSaleOf({ event: 'refund', netMinor: -4_200, memberLeftOn: '2026-10-26' }),
        THEO,
        ZONE,
      ),
    ).toBe(
      'Théo a quitté l’équipe le lundi 26 octobre, avant la vente de ce remboursement. Compté, sa vente va sur son relevé final et il s’en déduit.',
    );
    // Made off shift on the day he left, or before: only the day is added.
    expect(heldReasonText(heldSaleOf({ memberLeftOn: '2026-10-28' }), THEO, ZONE)).toBe(
      'Théo n’était ni en poste ni dans sa marge d’accès à l’heure de la vente. Théo a quitté l’équipe le mercredi 28 octobre.',
    );
    // The day of the sale is the agency's: 23 h 30 UTC on the 31st is already the 1st in Paris, after he left.
    expect(
      heldReasonText(
        heldSaleOf({
          occurredAt: '2026-10-31T23:30:00.000Z',
          saleOccurredAt: '2026-10-31T23:30:00.000Z',
          memberLeftOn: '2026-10-31',
        }),
        THEO,
        ZONE,
      ),
    ).toBe(
      'Théo a quitté l’équipe le samedi 31 octobre, avant cette vente. Comptée, elle va sur son relevé final, sans minimum de versement.',
    );
  });

  it('names the decision in force and each gesture, the member a count goes to', () => {
    expect(decisionText(heldSaleOf(), THEO, nameOf)).toBeNull();
    expect(decisionText(heldSaleOf({ decision: 'count' }), THEO, nameOf)).toBe('Comptée pour Théo');
    expect(decisionText(heldSaleOf({ decision: 'exclude' }), THEO, nameOf)).toBe('Écartée');
    expect(outcomeLabel('count', THEO)).toBe('Compter pour Théo');
    expect(outcomeLabel('count', null)).toBe('Compter');
    expect(outcomeLabel('exclude', THEO)).toBe('Écarter');
    expect(outcomeLabel('withdraw', THEO)).toBe('Retirer la décision');
    expect(outcomeLabel('give', THEO)).toBe('Donner à…');
  });

  it('names the member a sale is given to, and their share of a shared one (ADR 0101 §§ 6, 15)', () => {
    const given = (shareBp: number) => ({
      recipientMemberId: LEA_ID,
      shareBp,
      note: 'Elle a convaincu le fan',
    });
    expect(plain(decisionText(heldSaleOf({ decision: 'give', given: given(10_000) }), THEO, nameOf))).toBe(
      'Donnée à Léa',
    );
    expect(plain(decisionText(heldSaleOf({ decision: 'give', given: given(6_000) }), THEO, nameOf))).toBe(
      'Partagée avec Léa : 60 %',
    );
    expect(
      plain(
        decisionText(heldSaleOf({ event: 'refund', decision: 'give', given: given(10_000) }), THEO, nameOf),
      ),
    ).toBe('Sa vente est donnée à Léa');
    expect(
      plain(
        decisionText(heldSaleOf({ event: 'refund', decision: 'give', given: given(4_000) }), THEO, nameOf),
      ),
    ).toBe('Sa vente est partagée avec Léa : 40 %');
    expect(plain(decidedWhyText(heldSaleOf({ decision: 'give', given: given(10_000) })))).toBe(
      'Pourquoi : « Elle a convaincu le fan »',
    );
    expect(decidedWhyText(heldSaleOf({ decision: 'exclude', excludeReason: 'agent_decisive' }))).toBe(
      'L’IA a été décisive : la vente compte pour l’agent dans le Dashboard, jamais en paie.',
    );
    expect(decidedWhyText(heldSaleOf({ decision: 'exclude', excludeReason: 'other' }))).toBeNull();
    // « Donner à… » shows while the reader has someone to name.
    const outcomes = ['count', 'exclude', 'give', 'withdraw'] as const;
    expect(outcomesShown({ outcomes: [...outcomes], recipients: [] })).toEqual([
      'count',
      'exclude',
      'withdraw',
    ]);
    expect(outcomesShown({ outcomes: [...outcomes], recipients: [LEA_ID] })).toEqual([...outcomes]);
  });

  it('splits a shared net as the server does: the recipient’s part rounded once, the rest to the author', () => {
    expect(partsOf(10_001, 6_000)).toEqual({ recipient: 6_001, author: 4_000 });
    expect(partsOf(999, 5_000)).toEqual({ recipient: 500, author: 499 });
    expect(partsOf(-999, 5_000)).toEqual({ recipient: -500, author: -499 });
    for (let bp = 1_000; bp <= 9_000; bp += 1_000)
      for (const net of [1, 7, 999, 10_001, -333]) {
        const parts = partsOf(net, bp);
        expect(parts.recipient + parts.author).toBe(net);
      }
    expect([0, 940, 5_449, 9_600, 12_000].map(shareOnStep)).toEqual([1_000, 1_000, 5_000, 9_000, 9_000]);
  });

  it('says what a give does, whole or shared, and names its recipient on its button', () => {
    expect(giveWords(null, 10_000).confirm).toBe('Donner');
    expect(giveWords('Léa', 10_000)).toEqual({
      title: 'Donner cette vente',
      lead: 'Elle compte pour le membre choisi, à son taux et dans ses paliers, ses remboursements avec elle. Tu peux retirer la décision tant qu’aucune clôture n’a compté la vente.',
      confirm: 'Donner à Léa',
    });
    expect(giveWords('Léa', 6_000).confirm).toBe('Partager avec Léa');
    expect(giveWords('Léa', 6_000).lead).toContain('Chacun compte sa part du net');
  });

  it('counts for the owner the sales each validator gave in the month (ADR 0101 § 17)', () => {
    const named = (userId: string) => (userId === 'user-me' ? 'Toi' : 'Théo');
    expect(plain(giftCountText({ decidedBy: 'user-theo', given: 3, shared: 2 }, named))).toBe(
      'Théo : 3 ventes données, dont 2 partagées',
    );
    expect(plain(giftCountText({ decidedBy: 'user-me', given: 1, shared: 0 }, named))).toBe(
      'Toi : 1 vente donnée',
    );
  });

  it('recalls in a sheet who sold, and gives its note an example fitted to the gesture', () => {
    expect(saleSellerText(heldSaleOf(), THEO)).toBe('vendue par Théo');
    expect(saleSellerText(heldSaleOf({ memberId: null }), null)).toBe('vendue par un chatteur');
    expect(saleSellerText(heldSaleOf({ memberId: null, byAgent: true }), null)).toBe('vendue par l’IA');
    expect(notePlaceholder('exclude', 'agent_decisive')).toContain('message de l’IA');
    expect(notePlaceholder('exclude', 'other')).not.toBe(notePlaceholder('exclude', 'agent_decisive'));
    expect(notePlaceholder('count', null)).toContain('Shift prolongé');
    expect(giveNoteHint(false, false)).toBe(
      'Les deux membres la liront sur leur relevé. Jamais le message ni le nom d’un fan.',
    );
    expect(giveNoteHint(true, true)).toBe('Obligatoire : le membre la lira sur son relevé.');
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
    expect(decisionText(refund({ decision: 'count' }), THEO, nameOf)).toBe('Compté pour Théo');
    expect(decisionText(refund({ decision: 'count' }), null, nameOf)).toBe('Compté');
    expect(decisionText(refund({ decision: 'exclude' }), THEO, nameOf)).toBe('Écarté');
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
    expect(heldReasonText(unlinked, null, ZONE)).toBe(
      'Son chatteur sur Reveal n’est relié à aucun membre\u00a0: relie-le dans Équipe › Reveal et le remboursement se déduit seul. Sinon, écarte-le.',
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

  it('names who made a line: its member, else the Reveal account from the team, else the account as one', () => {
    const team = TeamImportOverviewSchema.parse({
      rows: [
        {
          chatter: {
            platformChatterId: 'chatter-new',
            firstName: 'Camille',
            lastName: 'Essai',
            email: null,
            role: 'chatter',
            isBot: false,
            isExternal: false,
            removedAt: null,
            platformModelIds: [],
          },
          link: null,
          dismissedAt: null,
          suggestion: null,
          preselected: false,
          actions: [],
          models: [],
          modelGap: { inImperaOnly: [], onPlatformOnly: [] },
          removal: null,
        },
      ],
      newCount: 1,
      removalCount: 0,
      abnormalRead: false,
      listError: null,
    });
    const unlinked = (platformChatterId: string | null) =>
      heldSaleOf({ memberId: null, platformChatterId, reason: 'chatter_unlinked' });
    expect(lineChatter(heldSaleOf(), THEO, team)).toEqual({ lead: 'chatteur', name: 'Théo' });
    expect(lineChatter(unlinked('chatter-new'), null, team)).toEqual({
      lead: 'chatteur',
      name: 'non relié · Camille Essai',
    });
    expect(lineChatter(unlinked('chatter-other'), null, team)).toEqual({
      lead: 'compte Reveal',
      name: 'non relié',
    });
    expect(lineChatter(unlinked('chatter-new'), null, undefined)).toEqual({
      lead: 'compte Reveal',
      name: 'non relié',
    });
    expect(lineChatter(unlinked(null), null, team)).toEqual({ lead: 'chatteur', name: 'non relié' });
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
