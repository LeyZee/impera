import { MySaleSchema, MySalesDaySchema, type MySale } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  myDayLine,
  myDayTitle,
  mySaleAmount,
  mySaleNote,
  mySalesCountText,
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
    expect(
      ['counted', 'signalled', 'excluded', 'removed'].map((state) =>
        mySaleStateText(MySaleSchema.shape.state.parse(state)),
      ),
    ).toEqual(['Comptée', 'Signalée', 'Écartée', 'Retirée du relevé']);
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
    expect(plain(mySignalNote(mineOf({ state: 'signalled', signal })))).toBe(
      '« Vendue pendant le shift de Lou »',
    );
    expect(mySignalNote(mineOf({ state: 'signalled', signal: { ...signal, note: null } }))).toBeNull();
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
    expect(signalLabel('signal')).toBe('Ce n’est pas ma vente');
    expect(signalLabel('withdraw')).toBe('Retirer le signalement');
    expect(signalWords('signal')).toEqual({
      title: 'Ce n’est pas ta vente ?',
      lead: 'Un valideur la verra. Elle reste sur ton relevé et compte pour toi tant qu’il ne l’a pas écartée. Tu peux retirer ton signalement jusqu’à la clôture.',
      confirm: 'Signaler la vente',
    });
    expect(signalWords('withdraw').confirm).toBe('Retirer le signalement');
  });
});
