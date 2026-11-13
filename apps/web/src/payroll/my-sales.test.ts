import { MySaleSchema, MySalesDaySchema, type MySale } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  myDayLine,
  myDayTitle,
  mySaleAmount,
  mySaleNote,
  mySalesCountText,
  mySalesIntro,
  mySalesNets,
  mySaleStateText,
  mySaleWaits,
  mySaleWhen,
  mySignalNote,
  signalLabel,
  signalWords,
} from './my-sales';

import { NORA_REVEAL } from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;
const plain = (text: string | null): string | null => (text === null ? null : text.replace(NBSP, ' '));

/** Invented lines only (ADR 0010): Théo's own statement on Nora's Reveal account. */
const mineOf = (patch: Partial<MySale> = {}): MySale =>
  MySaleSchema.parse({
    platform: 'reveal',
    platformSaleId: 'vente-1',
    event: 'sale',
    platformAccountId: NORA_REVEAL.id,
    currency: 'EUR',
    netMinor: 4_200,
    occurredAt: '2026-10-28T21:05:00.000Z',
    lateFrom: null,
    state: 'counted',
    signal: null,
    given: null,
    open: true,
    ...patch,
  });

describe('my sales read (CRM-03 lot b4c)', () => {
  it('says a line by its hour and net, never its key', () => {
    expect(plain(mySaleWhen(mineOf(), 'Europe/Paris'))).toBe('Vente de 22 h 05');
    expect(plain(mySaleWhen(mineOf({ event: 'refund', occurredAt: null }), 'Europe/Paris'))).toBe(
      'Remboursement, heure inconnue',
    );
    expect(plain(mySaleAmount(mineOf()))).toBe('+42,00 €');
    expect(plain(mySaleAmount(mineOf({ event: 'refund', netMinor: -1_000 })))).toBe('−10,00 €');
  });

  it('says where each line stands, amber only while a signal waits on an open period', () => {
    const states = ['counted', 'signalled', 'excluded', 'removed', 'given'].map((state) =>
      MySaleSchema.shape.state.parse(state),
    );
    expect(states.map((state) => mySaleStateText({ state, event: 'sale' }))).toEqual([
      'Comptée',
      'Signalée',
      'Écartée',
      'Retirée du relevé',
      'Donnée',
    ]);
    expect(states.map((state) => mySaleStateText({ state, event: 'refund' }))).toEqual([
      'Compté',
      'Signalé',
      'Écarté',
      'Retiré du relevé',
      'Sa vente est donnée',
    ]);
    const signal = { note: 'Vendue pendant le shift de Lou', signalledAt: '2026-10-29T08:00:00.000Z' };
    expect(mySaleWaits(mineOf({ state: 'signalled', signal }))).toBe(true);
    expect(mySaleWaits(mineOf({ state: 'signalled', signal, open: false }))).toBe(false);
    expect(mySaleWaits(mineOf())).toBe(false);
    expect(mySaleNote(mineOf(), false)).toBeNull();
    expect(mySaleNote(mineOf({ open: false }), false)).toBe('Comptée par une clôture : elle ne change plus.');
    expect(mySaleNote(mineOf({ open: false }), true)).toBeNull();
    expect(mySaleNote(mineOf({ state: 'signalled', signal }), false)).toBe(
      'Tu l’as signalée : elle compte pour toi tant qu’un valideur ne l’a pas écartée.',
    );
    expect(mySaleNote(mineOf({ state: 'signalled', signal, open: false }), true)).toBe(
      'Tu l’avais signalée, la clôture l’a comptée pour toi.',
    );
    expect(mySaleNote(mineOf({ state: 'excluded', signal, open: false }), false)).toBe(
      'Tu l’as signalée et un valideur l’a écartée : elle ne compte pas pour toi.',
    );
    expect(mySaleNote(mineOf({ state: 'removed', signal, open: false }), false)).toBe(
      'Tu l’avais signalée : elle n’est plus sur ton relevé.',
    );
    expect(mySaleNote(mineOf({ state: 'given' }), false)).toBe(
      'Un valideur l’a donnée à un autre membre, décisif sur cette vente : elle ne compte pas pour toi.',
    );
    expect(plain(mySignalNote(mineOf({ state: 'signalled', signal })))).toBe(
      '« Vendue pendant le shift de Lou »',
    );
    expect(mySignalNote(mineOf({ state: 'signalled', signal: { ...signal, note: null } }))).toBeNull();
  });

  it('says a refund as a refund: taken off the member’s sales, never « ma vente »', () => {
    const signal = { note: null, signalledAt: '2026-10-29T08:00:00.000Z' };
    const refund = (patch: Partial<MySale>): MySale =>
      mineOf({ event: 'refund', netMinor: -1_000, ...patch });
    expect(mySaleNote(refund({}), false)).toBeNull();
    expect(mySaleNote(refund({ open: false }), false)).toBe('Compté par une clôture : il ne change plus.');
    expect(mySaleNote(refund({ state: 'signalled', signal }), false)).toBe(
      'Tu l’as signalé : il se déduit de tes ventes tant qu’un valideur ne l’a pas écarté.',
    );
    expect(mySaleNote(refund({ state: 'signalled', signal, open: false }), true)).toBe(
      'Tu l’avais signalé, la clôture l’a déduit de tes ventes.',
    );
    expect(mySaleNote(refund({ state: 'excluded', signal, open: false }), false)).toBe(
      'Tu l’as signalé et un valideur l’a écarté : il ne se déduit pas de tes ventes.',
    );
    expect(mySaleNote(refund({ state: 'removed', signal, open: false }), false)).toBe(
      'Tu l’avais signalé : il n’est plus sur ton relevé.',
    );
    // ADR 0101: its sale given to another member, the refund follows it.
    expect(mySaleNote(refund({ state: 'given' }), false)).toBe(
      'Un valideur a donné sa vente à un autre membre : il ne se déduit pas de tes ventes.',
    );
    expect(signalLabel('signal', 'refund')).toBe('Ce remboursement n’est pas à moi');
    expect(signalLabel('withdraw', 'refund')).toBe('Retirer le signalement');
    expect(signalWords('signal', 'refund')).toEqual({
      title: 'Ce n’est pas ton remboursement ?',
      lead: 'Un valideur le verra. Le remboursement reste sur ton relevé et se déduit de tes ventes tant que le valideur ne l’a pas écarté. Tu peux retirer ton signalement jusqu’à la clôture.',
      confirm: 'Signaler le remboursement',
    });
    expect(signalWords('withdraw', 'refund').lead).toBe(
      'Le remboursement reste déduit de tes ventes et le valideur ne le voit plus comme signalé.',
    );
  });

  it('names the platform its lines were read on, never one written in', () => {
    expect(mySalesIntro(['reveal', 'reveal'], false)).toBe(
      'Les ventes de Reveal que ta quinzaine compte pour toi. Si l’une n’est pas à toi, signale-la : un valideur la verra et pourra l’écarter.',
    );
    expect(mySalesIntro(['onlyfans'], true)).toBe(
      'Les ventes de OnlyFans que ta quinzaine a comptées pour toi, et celles que tu as signalées.',
    );
    expect(mySalesIntro(['reveal', 'onlyfans'], false)).toMatch(/^Les ventes de la plateforme que/u);
    expect(mySalesIntro([], true)).toMatch(/^Les ventes de la plateforme que/u);
  });

  it('heads each day with its sales, refunds and net, and the panel with the period’s', () => {
    expect(myDayTitle('2026-10-28')).toBe('Mercredi 28 octobre');
    expect(myDayTitle('2026-11-01')).toBe('Dimanche 1er novembre');
    expect(myDayTitle(null)).toBe('Heure inconnue');
    const refunded = MySalesDaySchema.parse({
      day: '2026-10-30',
      sales: 0,
      refunds: 1,
      nets: [{ currency: 'EUR', netMinor: -1_000 }],
    });
    const sold = MySalesDaySchema.parse({
      day: '2026-10-28',
      sales: 3,
      refunds: 0,
      nets: [{ currency: 'EUR', netMinor: 12_600 }],
    });
    const days = [refunded, sold];
    expect(plain(myDayLine(sold))).toBe('3 ventes · 126,00 €');
    expect(plain(myDayLine(refunded))).toBe('1 remboursement · −10,00 €');
    expect(myDayLine(undefined)).toBe('Rien de compté ce jour');
    expect(plain(mySalesCountText(days))).toBe('3 ventes lues · 1 remboursement');
    expect(plain(mySalesCountText([sold]))).toBe('3 ventes lues');
    expect(mySalesNets(days)).toEqual([{ currency: 'EUR', netMinor: 11_600 }]);
  });

  it('names each gesture and what it does, a signal changing no amount by itself', () => {
    expect(signalLabel('signal', 'sale')).toBe('Ce n’est pas ma vente');
    expect(signalLabel('withdraw', 'sale')).toBe('Retirer le signalement');
    expect(signalWords('signal', 'sale')).toEqual({
      title: 'Ce n’est pas ta vente ?',
      lead: 'Un valideur la verra. Elle reste sur ton relevé et compte pour toi tant qu’il ne l’a pas écartée. Tu peux retirer ton signalement jusqu’à la clôture.',
      confirm: 'Signaler la vente',
    });
    expect(signalWords('withdraw', 'sale').confirm).toBe('Retirer le signalement');
  });
});
