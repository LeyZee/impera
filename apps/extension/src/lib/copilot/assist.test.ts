import { CopilotAssistSchema, type CopilotAssist, type CopilotNextMove } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { cutOf, eurosOf, moveLines, saleRows, saleSummary, signalWords } from './assist';
import { standingOf } from './standing';

/* Invented data (ADR 0010). */
const assist = (patch: Partial<CopilotAssist> = {}): CopilotAssist =>
  CopilotAssistSchema.parse({
    nextMove: { kind: 'reply', label: 'Répondre', priceMinor: null, block: null },
    reasons: [],
    sale: {
      script: { name: 'Soirée d’essai', stepIndex: 1, stepCount: 4 },
      nextStep: { name: 'Étape 3', priceMinor: 1500 },
      refusedSteps: [],
      usedObjections: [],
      customOrderOpen: false,
      offerPending: false,
    },
    signals: { desireTrend: null, followUpDue: false },
    cuts: [],
    buttons: [],
    clicksLeftToday: 30,
    ...patch,
  });

const move = (kind: CopilotNextMove['kind'], label: string, block: CopilotNextMove['block'] = null) => ({
  kind,
  label,
  priceMinor: kind === 'offer_step' ? 1500 : null,
  block,
});

describe('what the agent computed, said to the chatter (ADR 0141, lot a)', () => {
  it.each([
    ['reply', 'Répondre'],
    ['offer_step', 'Proposer Étape 3 à 15 €'],
    ['answer_objection', 'Répondre à son objection'],
    ['custom_order_accept', 'Commande perso : accepter'],
    ['custom_order_decline', 'Commande perso : refuser'],
    ['custom_order_wait', 'Commande perso : attendre'],
    ['wait', 'Attendre avant de répondre'],
    ['hand_over', 'Rendre la main à un humain'],
  ] as const)('says the gesture %s as the server words it, in a neutral tone', (kind, label) => {
    expect(moveLines(move(kind, label), [])).toEqual({ what: label, why: null, tone: 'neutral' });
  });

  it('says why under the gesture: the sale block first, then the reasons kept with the draft', () => {
    expect(
      moveLines(move('no_sale', 'Ne rien vendre', 'low_desire'), [
        { code: 'rewritten_once', label: 'Réécrit une fois par une garde' },
      ]),
    ).toEqual({
      what: 'Ne rien vendre',
      why: 'Désir encore trop bas · Réécrit une fois par une garde',
      tone: 'amber',
    });
    // Red only for « Ne plus lui écrire » among the blocks (§ 12); an age not confirmed yet is not a doubt.
    expect(moveLines(move('no_sale', 'Ne rien vendre', 'do_not_contact'), []).tone).toBe('red');
    expect(moveLines(move('no_sale', 'Ne rien vendre', 'age_unconfirmed'), []).tone).toBe('amber');
    expect(
      moveLines(move('hand_over', 'Rendre la main à un humain'), [
        { code: 'handoff', label: 'Il faut un humain' },
      ]).why,
    ).toBe('Il faut un humain');
  });

  it('cuts the sale on the server’s word, and on its own when his limits are not read or forbid a word', () => {
    const calm = standingOf({}, null);
    expect(cutOf(assist(), calm)).toBeNull();
    expect(cutOf(null, calm)).toBeNull();
    expect(cutOf(assist({ cuts: ['sales_frozen', 'care'] }), calm)).toBe('care');
    expect(cutOf(assist({ cuts: ['care_exit', 'age_doubt'] }), calm)).toBe('age_doubt');
    expect(cutOf(assist(), standingOf('unread', null))).toBe('limits_unread');
    expect(cutOf(null, standingOf({ doNotContact: true }, null))).toBe('do_not_contact');
  });

  it('writes a price of the code in euros', () => {
    expect(eurosOf(1500)).toBe('15\u00a0€');
    expect(eurosOf(1490)).toBe('14,90\u00a0€');
    expect(eurosOf(0)).toBe('0\u00a0€');
  });

  it('sums the sale up in one line: the step in progress, then the next one and its price', () => {
    const { sale } = assist();
    if (sale === null) throw new Error('sale');
    expect(saleSummary(sale)).toBe('Soirée d’essai, étape 2 sur 4 · ensuite Étape 3 à 15\u00a0€');
    expect(saleSummary({ ...sale, script: null, nextStep: null })).toBe('Pas de script en cours');
    expect(
      saleRows({
        ...sale,
        offerPending: true,
        refusedSteps: ['Étape 2'],
        usedObjections: ['C’est trop cher'],
        customOrderOpen: true,
      }).map(({ label }) => label),
    ).toEqual([
      'Script en cours',
      'Prochaine étape',
      'Offre faite',
      'Étapes refusées',
      'Objections déjà servies, à ne pas resservir',
      'Commande perso',
    ]);
  });

  it('gives the signals, the direction of his desire only, and none under a cut', () => {
    const lively = assist({
      signals: { desireTrend: 'up', followUpDue: true },
    });
    expect(signalWords(lively, null)).toEqual({ trend: 'en hausse', more: ['Relance due'] });
    expect(signalWords(assist({ signals: { desireTrend: 'down', followUpDue: false } }), null).trend).toBe(
      'en baisse',
    );
    expect(
      signalWords(assist({ signals: { desireTrend: 'flat', followUpDue: false } }), null).trend,
    ).toBeNull();
    const pending = assist();
    if (pending.sale === null) throw new Error('sale');
    expect(signalWords({ ...pending, sale: { ...pending.sale, offerPending: true } }, null).more).toEqual([
      'Offre sans réponse',
    ]);
    expect(signalWords(lively, 'care')).toEqual({ trend: null, more: [] });
    expect(signalWords(null, null)).toEqual({ trend: null, more: [] });
  });
});
