import {
  CreatorEarningsPeriodSchema,
  newId,
  PlatformAccountIdSchema,
  PayPeriodSchema,
  type CreatorSaleLine,
  type CreatorSales,
  type CreatorSalesRow,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorEarnings } from '../creator-earnings';

// Everything below is invented (ADR 0010).
const ACCOUNT = newId(PlatformAccountIdSchema);
const ACCOUNT_2 = newId(PlatformAccountIdSchema);
const NOVEMBER = PayPeriodSchema.parse('2026-11-01');

function row(overrides: Partial<CreatorSalesRow>): CreatorSalesRow {
  return {
    day: '2026-11-03',
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    currency: 'EUR',
    saleType: 'ppv',
    sales: 1,
    refunds: 0,
    grossInclVatMinor: 1200,
    grossExclVatMinor: 1000,
    netMinor: 800,
    agencyMinor: 300,
    creatorMinor: 500,
    ...overrides,
  };
}

function refund(overrides: Partial<CreatorSaleLine>): CreatorSaleLine {
  return {
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    event: 'refund',
    saleType: 'ppv',
    occurredAt: '2026-11-05T10:00:00.000Z',
    saleDay: '2026-11-03',
    currency: 'EUR',
    grossInclVatMinor: 1200,
    grossExclVatMinor: 1000,
    netMinor: 800,
    agencyMinor: 300,
    creatorMinor: 500,
    fanId: null,
    ...overrides,
  };
}

const sales = (
  rows: CreatorSalesRow[],
  lines: CreatorSaleLine[] = [],
  refundsWithoutSale = 0,
): CreatorSales => ({
  from: NOVEMBER,
  to: '2026-11-10',
  rows,
  lines,
  refundsWithoutSale,
});

describe('her share over a fortnight (ADR 0106 § 15 to § 19)', () => {
  it('sums her days by currency, accounts and kinds together, newest day first, each currency apart', () => {
    const period = creatorEarnings(
      sales([
        row({ day: '2026-11-03' }),
        row({ day: '2026-11-03', saleType: 'tip', creatorMinor: 250 }),
        row({ day: '2026-11-03', platformAccountId: ACCOUNT_2, creatorMinor: 1_000, sales: 2 }),
        row({ day: '2026-11-03', currency: 'USD', creatorMinor: 700 }),
        row({ day: '2026-11-07', creatorMinor: 300 }),
      ]),
      NOVEMBER,
    );
    expect(CreatorEarningsPeriodSchema.parse(period)).toEqual(period);
    expect(period).toEqual({
      from: NOVEMBER,
      to: '2026-11-10',
      totals: [
        { currency: 'EUR', shareMinor: 2_050, sales: 5, refunds: 0, refundedMinor: 0 },
        { currency: 'USD', shareMinor: 700, sales: 1, refunds: 0, refundedMinor: 0 },
      ],
      days: [
        {
          day: '2026-11-07',
          sums: [{ currency: 'EUR', shareMinor: 300, sales: 1, refunds: 0, refundedMinor: 0 }],
        },
        {
          day: '2026-11-03',
          sums: [
            { currency: 'EUR', shareMinor: 1_750, sales: 4, refunds: 0, refundedMinor: 0 },
            { currency: 'USD', shareMinor: 700, sales: 1, refunds: 0, refundedMinor: 0 },
          ],
        },
      ],
      refundsWithoutSale: 0,
    });
  });

  it('says what a refund took off, on its sale’s day, her share already net of it', () => {
    // The register's row already nets the refund out: one sale, one refund, nothing left of it.
    const period = creatorEarnings(
      sales([row({ sales: 2, refunds: 1, creatorMinor: 500 })], [refund({ creatorMinor: 500 })], 1),
      NOVEMBER,
    );
    expect(period.totals).toEqual([
      { currency: 'EUR', shareMinor: 500, sales: 2, refunds: 1, refundedMinor: 500 },
    ]);
    expect(period.days).toEqual([
      {
        day: '2026-11-03',
        sums: [{ currency: 'EUR', shareMinor: 500, sales: 2, refunds: 1, refundedMinor: 500 }],
      },
    ]);
    expect(period.refundsWithoutSale).toBe(1);
  });

  it('reads an empty fortnight as nothing, never a zero day', () => {
    expect(creatorEarnings(sales([]), NOVEMBER)).toEqual({
      from: NOVEMBER,
      to: '2026-11-10',
      totals: [],
      days: [],
      refundsWithoutSale: 0,
    });
  });

  it('gives out nothing but her share: no agency share, no net, no price', () => {
    const period = creatorEarnings(sales([row({})], [refund({})]), NOVEMBER);
    expect(JSON.stringify(period)).not.toMatch(/agency|net|gross|fan/u);
  });
});
