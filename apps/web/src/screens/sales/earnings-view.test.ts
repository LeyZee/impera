import { describe, expect, it } from 'vitest';

import { pathOf, per100, periodName, refundOf, shareText } from './earnings-view';

describe('periodName (CR-04)', () => {
  it('names a day, a fortnight and a month as she reads them', () => {
    expect(periodName({ period: 'day', from: '2026-11-03', to: '2026-11-03' }, '2026-11-03')).toBe(
      'Aujourd’hui',
    );
    expect(periodName({ period: 'day', from: '2026-11-02', to: '2026-11-02' }, '2026-11-03')).toBe('Hier');
    expect(periodName({ period: 'fortnight', from: '2026-10-01', to: '2026-10-15' }, '2026-11-03')).toBe(
      '1er – 15 oct.',
    );
    expect(periodName({ period: 'fortnight', from: '2026-10-16', to: '2026-10-31' }, '2026-11-03')).toBe(
      '16 – 31 oct.',
    );
    expect(periodName({ period: 'month', from: '2026-10-01', to: '2026-10-31' }, '2026-11-03')).toBe(
      'octobre 2026',
    );
  });
});

describe('the path of her sales (ADR 0157)', () => {
  it('cuts what her fans paid into the VAT, Reveal, the agency and her, from Reveal’s own steps', () => {
    expect(
      pathOf({
        grossInclVatMinor: 6000,
        grossExclVatMinor: 5000,
        netMinor: 4000,
        agencyMinor: 1550,
        creatorMinor: 2450,
      }).map((step) => [step.part, step.minor]),
    ).toEqual([
      ['vat', 1000],
      ['platform', 1000],
      ['agency', 1550],
      ['creator', 2450],
    ]);
  });

  it('says a share as she reads it, a dash without one', () => {
    expect(shareText(7000).replace(/\s/gu, ' ')).toBe('70 %');
    expect(shareText(6667).replace(/\s/gu, ' ')).toBe('66,7 %');
    expect(shareText(null)).toBe('–');
    expect(per100({ shareOfPaidBp: 4083, currency: 'EUR' })?.replace(/\s/gu, ' ')).toBe(
      'Sur 100 € payés par tes fans, 40,83 € pour toi.',
    );
    expect(per100({ shareOfPaidBp: null, currency: 'EUR' })).toBeNull();
  });

  it('ties a refund to the day of its sale when it is another', () => {
    const refund = {
      event: 'refund' as const,
      occurredAt: '2026-11-03T11:40:00.000Z',
      saleDay: '2026-11-02',
    };
    expect(refundOf(refund, '2026-11-03')).toBe('d’une vente du 2 nov.');
    expect(refundOf({ ...refund, saleDay: '2026-11-03' }, '2026-11-03')).toBeNull();
    expect(refundOf({ ...refund, event: 'sale' }, '2026-11-03')).toBeNull();
  });
});
