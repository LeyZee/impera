import { CreatorSalesSchema, FanIdSchema, newId, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorSales, type CreatorLine } from '../creator-sales';

// Everything below is invented (ADR 0010).
const ACCOUNT = newId(PlatformAccountIdSchema);
const FAN = newId(FanIdSchema);
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

function line(overrides: Partial<CreatorLine> & Pick<CreatorLine, 'platformSaleId'>): CreatorLine {
  return {
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    event: 'sale',
    saleType: 'ppv',
    currency: 'EUR',
    occurredAt: new Date('2026-10-20T10:00:00Z'),
    grossInclVat: 1200,
    grossExclVat: 1000,
    net: 800,
    agency: 300,
    creator: 500,
    fanId: FAN,
    ...overrides,
  };
}

describe('a creator’s own sales (CRM-04 lot d)', () => {
  it('sums a day per kind, a refund taken off its sale’s day, with no seller', () => {
    const sales = creatorSales(
      [
        line({ platformSaleId: 'sale_1' }),
        line({ platformSaleId: 'sale_2', occurredAt: new Date('2026-10-20T11:00:00Z'), fanId: null }),
        line({ platformSaleId: 'sale_3', saleType: 'tip', creator: 250, agency: 150, net: 400 }),
        // Refunded in November: still the 20th of October.
        line({
          platformSaleId: 'sale_2',
          event: 'refund',
          occurredAt: new Date('2026-11-02T09:00:00Z'),
          fanId: null,
        }),
      ],
      OCTOBER,
    );
    expect(sales.rows).toEqual([
      {
        day: '2026-10-20',
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        saleType: 'ppv',
        sales: 2,
        refunds: 1,
        grossInclVatMinor: 1200,
        grossExclVatMinor: 1000,
        netMinor: 800,
        agencyMinor: 300,
        creatorMinor: 500,
      },
      expect.objectContaining({ day: '2026-10-20', saleType: 'tip', sales: 1, creatorMinor: 250 }),
    ]);
    // Each line on its sale's day, by instant, amounts as recorded and never signed.
    expect(sales.lines.map((one) => [one.event, one.saleDay, one.creatorMinor, one.fanId])).toEqual([
      ['sale', '2026-10-20', 500, FAN],
      ['sale', '2026-10-20', 250, FAN],
      ['sale', '2026-10-20', 500, null],
      ['refund', '2026-10-20', 500, null],
    ]);
    expect(sales.refundsWithoutSale).toBe(0);
  });

  it('reads the day in Paris, and only counts a refund whose sale is older than the register', () => {
    const sales = creatorSales(
      [
        // 23:30 UTC on 30/09 is the 1st of October in Paris; 22:30 UTC on 31/10 is the 1st of November.
        line({ platformSaleId: 'sale_first', occurredAt: new Date('2026-09-30T23:30:00Z') }),
        line({ platformSaleId: 'sale_after', occurredAt: new Date('2026-10-31T23:30:00Z') }),
        line({ platformSaleId: 'sale_old', event: 'refund', occurredAt: new Date('2026-10-05T09:00:00Z') }),
      ],
      OCTOBER,
    );
    expect(sales.rows.map((row) => [row.day, row.sales])).toEqual([['2026-10-01', 1]]);
    expect(sales.lines.map((one) => one.saleDay)).toEqual(['2026-10-01']);
    expect(sales.refundsWithoutSale).toBe(1);
  });

  it('fits the strict contract of her screen, which refuses a seller or the platform’s fan', () => {
    const sales = creatorSales([line({ platformSaleId: 'sale_1' })], OCTOBER);
    expect(CreatorSalesSchema.parse(sales)).toEqual(sales);
    const [row] = sales.rows;
    const [one] = sales.lines;
    expect(
      CreatorSalesSchema.safeParse({ ...sales, rows: [{ ...row, seller: { kind: 'agent' } }] }).success,
    ).toBe(false);
    expect(
      CreatorSalesSchema.safeParse({ ...sales, lines: [{ ...one, platformFanId: 'fan-1' }] }).success,
    ).toBe(false);
    expect(
      CreatorSalesSchema.safeParse({ ...sales, lines: [{ ...one, platformChatterId: 'c-1' }] }).success,
    ).toBe(false);
  });
});
