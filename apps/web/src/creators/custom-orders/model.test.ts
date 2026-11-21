import { CustomOrderViewSchema, type CustomOrderView } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { actionsOf, detailLines, headlineOf, priceLine, progressOf, proposedMinor, stepsOf } from './model';

/* An invented order with neutral values (ADR 0010). */
const order = (over: Partial<CustomOrderView> = {}): CustomOrderView =>
  CustomOrderViewSchema.parse({
    id: '0192f3a0-0000-7000-8000-0000000000a1',
    fanId: '0192f3a0-0000-7000-8000-0000000000b1',
    fanName: 'Basile',
    conversationId: null,
    state: 'awaiting_creator',
    format: 'video',
    supplements: [],
    minutes: 3,
    details: { what: 'test', when: 'demain' },
    card: {
      format: 'video',
      supplements: [],
      minutes: 3,
      details: { what: 'test', when: 'demain' },
      quote: { kind: 'price', totalMinor: 5000, lines: [] },
      to: 'creator',
      missing: [],
    },
    priceMinor: null,
    depositMinor: null,
    createdAt: '2026-11-21T10:00:00.000Z',
    updatedAt: '2026-11-21T10:00:00.000Z',
    decidedAt: null,
    ...over,
  });

describe('a custom order as the screens say it', () => {
  it('a video waits on her: card done, then her yes, the deposit and delivery', () => {
    expect(stepsOf(order())).toEqual([
      { label: 'Fiche complète', done: true },
      { label: 'Son oui', done: false },
      { label: 'Acompte', done: false },
      { label: 'Livrée', done: false },
    ]);
    expect(progressOf(order())).toBe(25);
    expect(actionsOf(order())).toEqual([{ kind: 'decide' }]);
    expect(proposedMinor(order())).toBe(5000);
  });

  it('a photo takes no deposit: three steps, delivered next', () => {
    const yes = order({ state: 'creator_yes', format: 'photo', minutes: null, priceMinor: 2000 });
    expect(stepsOf(yes).map((step) => step.label)).toEqual(['Fiche complète', 'Son oui', 'Livrée']);
    expect(priceLine(yes)).toBe('20 € à la livraison');
    expect(actionsOf(yes).map((action) => (action.kind === 'advance' ? action.to : action.kind))).toEqual([
      'delivered',
      'cancelled',
    ]);
  });

  it('says her price with the deposit, then the full price paid for a call', () => {
    expect(priceLine(order({ state: 'creator_yes', priceMinor: 5000, depositMinor: 2500 }))).toBe(
      '50 € · acompte 25 €',
    );
    const call = order({ state: 'creator_yes', format: 'call', priceMinor: 3000, depositMinor: 3000 });
    expect(priceLine(call)).toBe('30 € payés d’avance');
    expect(stepsOf(call).map((step) => step.label)).toEqual(['Fiche complète', 'Son oui', 'Payé', 'Livrée']);
    expect(actionsOf(call)[0]).toMatchObject({ to: 'deposit_paid', label: 'Paiement reçu' });
  });

  it('a delivered order is full and closed; a refused one offers nothing', () => {
    expect(progressOf(order({ state: 'delivered', priceMinor: 5000, depositMinor: 2500 }))).toBe(100);
    expect(actionsOf(order({ state: 'creator_no' }))).toEqual([]);
  });

  it('labels his details and his format', () => {
    expect(detailLines(order())).toEqual([
      { label: 'Ce qu’il veut', value: 'test' },
      { label: 'Pour quand', value: 'demain' },
    ]);
    expect(headlineOf(order())).toBe('Vidéo pour lui · 3 min');
    expect(headlineOf(order({ format: null, minutes: null }))).toBe('Demande à préciser');
  });
});
