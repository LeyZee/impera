import { MyFiguresSchema, type MyFigures } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  barHeight,
  bestSlot,
  changeText,
  changeWords,
  figuresCurrency,
  fortnightBars,
  fortnightChange,
  hasOtherCurrency,
  heatGrid,
  netIn,
  recordToday,
  slotWords,
  tierShare,
} from './my-figures';

/** Invented figures only (ADR 0010). */
const figures = (over: Partial<Record<keyof MyFigures, unknown>> = {}): MyFigures =>
  MyFiguresSchema.parse({
    period: '2026-11-01',
    today: '2026-11-05',
    timeZone: 'Europe/Paris',
    days: [
      { day: '2026-11-02', sales: 2, refunds: 0, nets: [{ currency: 'EUR', netMinor: 6_000 }] },
      { day: '2026-11-04', sales: 1, refunds: 1, nets: [{ currency: 'EUR', netMinor: -500 }] },
    ],
    nets: [{ currency: 'EUR', netMinor: 5_500 }],
    previous: {
      period: '2026-10-16',
      days: [],
      toDateNets: [{ currency: 'EUR', netMinor: 5_000 }],
    },
    hours: { since: '2026-09-10', sales: 0, enough: false, cells: [] },
    records: { bestDay: null, bestPeriod: null },
    ...over,
  });

describe('Mes chiffres, côté écran (ADR 0104 § A)', () => {
  it('dessine dans la devise qui rapporte le plus, sinon celle des records, sinon l’euro', () => {
    expect(
      figuresCurrency(
        figures({
          nets: [
            { currency: 'EUR', netMinor: 1 },
            { currency: 'USD', netMinor: 2 },
          ],
        }),
      ),
    ).toBe('USD');
    expect(
      figuresCurrency(
        figures({
          nets: [],
          records: { bestDay: null, bestPeriod: { period: '2026-10-16', currency: 'USD', netMinor: 9 } },
        }),
      ),
    ).toBe('USD');
    expect(figuresCurrency(figures({ nets: [] }))).toBe('EUR');
    expect(hasOtherCurrency(figures(), 'EUR')).toBe(false);
    expect(
      hasOtherCurrency(
        figures({
          nets: [
            { currency: 'EUR', netMinor: 1 },
            { currency: 'USD', netMinor: 2 },
          ],
        }),
        'USD',
      ),
    ).toBe(true);
    expect(netIn([], 'EUR')).toBe(0);
  });

  it('garde toute la quinzaine en barres : les jours à venir vides, aujourd’hui marqué', () => {
    const bars = fortnightBars(figures(), 'EUR');
    expect(bars).toHaveLength(15);
    expect(bars[1]).toMatchObject({
      day: '2026-11-02',
      netMinor: 6_000,
      sales: 2,
      today: false,
      ahead: false,
    });
    expect(bars[4]).toMatchObject({ day: '2026-11-05', netMinor: 0, today: true, ahead: false });
    expect(bars[5]).toMatchObject({ ahead: true });
    // La seconde quinzaine de février s'arrête au 28.
    expect(
      fortnightBars(figures({ period: '2026-02-16', today: '2026-02-20', days: [] }), 'EUR'),
    ).toHaveLength(13);
  });

  it('ne dessine jamais une barre sous le sol', () => {
    expect(barHeight(-500, 6_000)).toBe(0);
    expect(barHeight(6_000, 6_000)).toBe(1);
    expect(barHeight(60, 6_000)).toBe(0.04);
    expect(barHeight(100, 0)).toBe(0);
  });

  it('compare au même jour de la quinzaine d’avant, sans rien dire s’il n’y a rien à comparer', () => {
    expect(fortnightChange(figures(), 'EUR')).toBe(10);
    expect(fortnightChange(figures({ previous: null }), 'EUR')).toBeNull();
    expect(
      fortnightChange(figures({ previous: { period: '2026-10-16', days: [], toDateNets: [] } }), 'EUR'),
    ).toBeNull();
    expect(changeText(10)).toBe('10\u00a0%');
    expect(changeText(-4)).toBe('4\u00a0%');
    expect(changeWords(-4)).toContain('de moins');
  });

  it('pose les ventes sur sept jours de vingt-quatre heures et trouve le meilleur créneau de trois heures', () => {
    const grid = heatGrid(
      [
        { weekday: 2, hour: 21, sales: 3, nets: [{ currency: 'EUR', netMinor: 9_000 }] },
        { weekday: 2, hour: 23, sales: 1, nets: [{ currency: 'EUR', netMinor: 3_000 }] },
        { weekday: 5, hour: 10, sales: 1, nets: [{ currency: 'EUR', netMinor: 4_000 }] },
      ],
      'EUR',
    );
    expect(grid).toHaveLength(7);
    expect(grid[1]?.[21]).toEqual({ netMinor: 9_000, sales: 3 });
    const slot = bestSlot(grid);
    expect(slot).toEqual({ weekday: 2, from: 21, share: 75 });
    expect(slot === null ? '' : slotWords(slot)).toBe('le mardi de 21\u00a0h à minuit');
    expect(slotWords({ weekday: 4, from: 9 })).toBe('le jeudi de 9\u00a0h à 12\u00a0h');
    expect(bestSlot(heatGrid([], 'EUR'))).toBeNull();
  });

  it('mesure le chemin vers le prochain palier entre 0 et 1', () => {
    expect(tierShare(150_00, 100_00, 200_00)).toBe(0.5);
    expect(tierShare(50_00, 100_00, 200_00)).toBe(0);
    expect(tierShare(900_00, 100_00, 200_00)).toBe(1);
  });

  it('sait que le record tombe aujourd’hui', () => {
    const today = figures({
      records: { bestDay: { day: '2026-11-05', currency: 'EUR', netMinor: 9_000 }, bestPeriod: null },
    });
    expect(recordToday(today)).toBe(true);
    expect(recordToday(figures())).toBe(false);
  });
});
