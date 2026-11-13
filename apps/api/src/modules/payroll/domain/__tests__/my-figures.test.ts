import { MY_FIGURES_MIN_SALES, PayPeriodSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { mainCurrencyOf, myFigures, weekHourAt, type FigureLine } from '../my-figures';

/** Invented lines only (ADR 0010): Théo's own statements, in Paris. */
const P_OCT_2 = PayPeriodSchema.parse('2026-10-16');
const P_NOV_1 = PayPeriodSchema.parse('2026-11-01');
const PARIS = 'Europe/Paris';
const NOW = new Date('2026-11-05T12:00:00.000Z');

const line = (
  period: FigureLine['period'],
  at: string | null,
  netMinor = 4_000,
  currency: FigureLine['currency'] = 'EUR',
): FigureLine => ({
  period,
  event: netMinor < 0 ? 'refund' : 'sale',
  currency,
  netMinor,
  occurredAt: at === null ? null : new Date(at),
});

const figures = (lines: readonly FigureLine[], memberZone = PARIS) =>
  myFigures({ lines, now: NOW, agencyZone: PARIS, memberZone, period: P_NOV_1 });

describe('Les chiffres d’un chatteur (ADR 0104 § A)', () => {
  it('donne la quinzaine en cours jour par jour, du plus ancien au plus récent, dans le fuseau de l’agence', () => {
    const read = figures([
      line(P_NOV_1, '2026-11-03T20:00:00.000Z', 5_000),
      // 23 h 30 UTC le 1er = le 2 à Paris.
      line(P_NOV_1, '2026-11-01T23:30:00.000Z', 3_000),
      line(P_NOV_1, '2026-11-03T21:00:00.000Z', -1_000),
    ]);
    expect(read.today).toBe('2026-11-05');
    expect(read.days).toEqual([
      { day: '2026-11-02', sales: 1, refunds: 0, nets: [{ currency: 'EUR', netMinor: 3_000 }] },
      { day: '2026-11-03', sales: 1, refunds: 1, nets: [{ currency: 'EUR', netMinor: 4_000 }] },
    ]);
    expect(read.nets).toEqual([{ currency: 'EUR', netMinor: 7_000 }]);
  });

  it('compte une ligne sans heure dans le net de la quinzaine, jamais dans un jour', () => {
    const read = figures([line(P_NOV_1, null, 2_000), line(P_NOV_1, '2026-11-02T10:00:00.000Z', 1_000)]);
    expect(read.days).toHaveLength(1);
    expect(read.nets).toEqual([{ currency: 'EUR', netMinor: 3_000 }]);
  });

  it('arrête la quinzaine précédente au même jour : le 5 se compare au 20', () => {
    const read = figures([
      line(P_OCT_2, '2026-10-17T10:00:00.000Z', 1_000),
      line(P_OCT_2, '2026-10-20T10:00:00.000Z', 2_000),
      line(P_OCT_2, '2026-10-21T10:00:00.000Z', 9_000),
      // Une vente arrivée en retard d'avant la quinzaine compte dès le premier jour.
      line(P_OCT_2, '2026-10-10T10:00:00.000Z', 500),
    ]);
    expect(read.previous?.period).toBe(P_OCT_2);
    expect(read.previous?.toDateNets).toEqual([{ currency: 'EUR', netMinor: 3_500 }]);
    expect(read.previous?.days).toHaveLength(4);
  });

  it('ne compare à rien sans relevé pour la quinzaine précédente', () => {
    expect(figures([line(P_NOV_1, '2026-11-02T10:00:00.000Z')]).previous).toBeNull();
  });

  it('range les ventes des 8 dernières semaines par jour et heure du fuseau du chatteur, sans les remboursements', () => {
    const read = figures(
      [
        // Mardi 3 novembre, 21 h 15 à Paris = 21 h 15 à Cotonou (UTC+1 tous les deux en hiver).
        line(P_NOV_1, '2026-11-03T20:15:00.000Z', 4_000),
        line(P_NOV_1, '2026-11-03T20:45:00.000Z', 6_000),
        line(P_NOV_1, '2026-11-03T20:50:00.000Z', -6_000),
        // Trop ancienne : plus de 8 semaines.
        line(P_OCT_2, '2026-08-01T10:00:00.000Z', 9_000),
      ],
      'Africa/Porto-Novo',
    );
    expect(read.timeZone).toBe('Africa/Porto-Novo');
    expect(read.hours.sales).toBe(2);
    expect(read.hours.enough).toBe(false);
    expect(read.hours.since).toBe('2026-09-10');
    expect(read.hours.cells).toEqual([
      { weekday: 2, hour: 21, sales: 2, nets: [{ currency: 'EUR', netMinor: 10_000 }] },
    ]);
  });

  it('ne conclut qu’à partir de 30 ventes', () => {
    const many = Array.from({ length: MY_FIGURES_MIN_SALES }, (_, index) =>
      line(P_NOV_1, `2026-11-0${String((index % 4) + 1)}T1${String(index % 10)}:00:00.000Z`),
    );
    expect(figures(many).hours.enough).toBe(true);
    expect(figures(many.slice(1)).hours.enough).toBe(false);
  });

  it('lit le jour et l’heure dans le fuseau donné', () => {
    // Dimanche 23 h 30 UTC = lundi 0 h 30 à Paris.
    expect(weekHourAt(new Date('2026-11-01T23:30:00.000Z'), PARIS)).toEqual({ weekday: 1, hour: 0 });
    expect(weekHourAt(new Date('2026-11-01T23:30:00.000Z'), 'UTC')).toEqual({ weekday: 7, hour: 23 });
  });

  it('donne le meilleur jour et la meilleure quinzaine, dans la devise qui a le plus rapporté', () => {
    const read = figures([
      line(P_OCT_2, '2026-10-17T10:00:00.000Z', 8_000),
      line(P_OCT_2, '2026-10-17T12:00:00.000Z', 2_000),
      line(P_OCT_2, '2026-10-18T12:00:00.000Z', 1_000),
      line(P_NOV_1, '2026-11-02T10:00:00.000Z', 10_000),
      line(P_NOV_1, '2026-11-02T11:00:00.000Z', 90_000, 'USD'),
      line(P_NOV_1, '2026-11-03T11:00:00.000Z', -500),
      line(P_NOV_1, '2026-11-04T11:00:00.000Z', 99_000, 'EUR'),
    ]);
    expect(mainCurrencyOf([line(P_NOV_1, null, 1, 'USD'), line(P_NOV_1, null, 2, 'EUR')])).toBe('EUR');
    expect(read.records.bestDay).toEqual({ day: '2026-11-04', currency: 'EUR', netMinor: 99_000 });
    expect(read.records.bestPeriod).toEqual({ period: P_NOV_1, currency: 'EUR', netMinor: 108_500 });
  });

  it('garde le premier jour à avoir atteint un montant, et ne fait jamais un record d’un zéro ni d’une perte', () => {
    const tie = figures([
      line(P_OCT_2, '2026-10-17T10:00:00.000Z', 5_000),
      line(P_NOV_1, '2026-11-02T10:00:00.000Z', 5_000),
    ]);
    expect(tie.records.bestDay?.day).toBe('2026-10-17');
    const loss = figures([line(P_NOV_1, '2026-11-02T10:00:00.000Z', -5_000)]);
    expect(loss.records).toEqual({ bestDay: null, bestPeriod: null });
  });

  it('rend tout vide sans une ligne', () => {
    const none = figures([]);
    expect(none.days).toEqual([]);
    expect(none.nets).toEqual([]);
    expect(none.previous).toBeNull();
    expect(none.hours.cells).toEqual([]);
    expect(none.records).toEqual({ bestDay: null, bestPeriod: null });
  });
});
