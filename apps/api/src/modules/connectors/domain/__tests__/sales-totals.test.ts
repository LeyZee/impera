import { newId, PlatformAccountIdSchema, TeamMemberIdSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { salesFeedTimeZone } from '../sale-days';
import { ringsWhenRecorded, SALE_RING_WINDOW_MS, salesTotals, type TotalsLine } from '../sales-totals';

// Everything below is invented (ADR 0010).
const ACCOUNT = newId(PlatformAccountIdSchema);
const THEO = newId(TeamMemberIdSchema);
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

function line(overrides: Partial<TotalsLine> & Pick<TotalsLine, 'platformSaleId'>): TotalsLine {
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
    seller: { kind: 'member', memberId: THEO },
    ...overrides,
  };
}

describe('sales totals (CRM-04)', () => {
  it('sums a day per kind and seller, a refund taken off its sale’s day and counted with its sale’s seller', () => {
    const totals = salesTotals(
      [
        line({ platformSaleId: 'sale_1' }),
        line({ platformSaleId: 'sale_2', occurredAt: new Date('2026-10-20T11:00:00Z') }),
        line({ platformSaleId: 'sale_3', seller: { kind: 'agent' } }),
        line({ platformSaleId: 'sale_4', saleType: 'tip', seller: { kind: 'none' } }),
        // Refunded in November, by a chatter linked elsewhere since: still the 20th of October, still Théo's.
        line({
          platformSaleId: 'sale_2',
          event: 'refund',
          occurredAt: new Date('2026-11-02T09:00:00Z'),
          seller: { kind: 'unlinked' },
        }),
      ],
      OCTOBER,
    );
    expect(totals).toEqual({
      ...OCTOBER,
      refundsWithoutSale: 0,
      rows: [
        {
          day: '2026-10-20',
          platform: 'reveal',
          platformAccountId: ACCOUNT,
          currency: 'EUR',
          saleType: 'ppv',
          seller: { kind: 'agent' },
          sales: 1,
          refunds: 0,
          grossInclVatMinor: 1200,
          grossExclVatMinor: 1000,
          netMinor: 800,
          agencyMinor: 300,
          creatorMinor: 500,
        },
        {
          day: '2026-10-20',
          platform: 'reveal',
          platformAccountId: ACCOUNT,
          currency: 'EUR',
          saleType: 'ppv',
          seller: { kind: 'member', memberId: THEO },
          sales: 2,
          refunds: 1,
          grossInclVatMinor: 1200,
          grossExclVatMinor: 1000,
          netMinor: 800,
          agencyMinor: 300,
          creatorMinor: 500,
        },
        {
          day: '2026-10-20',
          platform: 'reveal',
          platformAccountId: ACCOUNT,
          currency: 'EUR',
          saleType: 'tip',
          seller: { kind: 'none' },
          sales: 1,
          refunds: 0,
          grossInclVatMinor: 1200,
          grossExclVatMinor: 1000,
          netMinor: 800,
          agencyMinor: 300,
          creatorMinor: 500,
        },
      ],
    });
  });

  it('reads the day in the platform’s zone, keeps each currency apart and leaves the days out of the range', () => {
    const totals = salesTotals(
      [
        // 23:30 UTC on 30/09: the 1st of October in Paris. 22:30 UTC on 31/10: the 1st of November.
        line({ platformSaleId: 'sale_first', occurredAt: new Date('2026-09-30T23:30:00Z') }),
        line({ platformSaleId: 'sale_out', occurredAt: new Date('2026-10-31T23:30:00Z') }),
        line({ platformSaleId: 'sale_usd', currency: 'USD', occurredAt: new Date('2026-10-01T09:00:00Z') }),
        // The refund of a sale out of the range is out of it too, whatever its own day.
        line({ platformSaleId: 'sale_out', event: 'refund', occurredAt: new Date('2026-10-31T23:50:00Z') }),
      ],
      OCTOBER,
    );
    expect(totals.rows.map((row) => [row.day, row.currency, row.sales])).toEqual([
      ['2026-10-01', 'EUR', 1],
      ['2026-10-01', 'USD', 1],
    ]);
  });

  it('counts apart a refund of the range whose sale is older than the register, in no row', () => {
    const totals = salesTotals(
      [
        line({ platformSaleId: 'sale_old', event: 'refund', occurredAt: new Date('2026-10-05T09:00:00Z') }),
        line({ platformSaleId: 'sale_older', event: 'refund', occurredAt: new Date('2026-09-05T09:00:00Z') }),
      ],
      OCTOBER,
    );
    expect(totals).toEqual({ ...OCTOBER, rows: [], refundsWithoutSale: 1 });
  });

  it('refuses a platform without a sales feed’s zone', () => {
    expect(salesFeedTimeZone('reveal')).toBe('Europe/Paris');
    expect(salesFeedTimeZone('onlyfans')).toBeNull();
    expect(() => salesTotals([line({ platformSaleId: 'sale_of', platform: 'onlyfans' })], OCTOBER)).toThrow();
  });
});

describe('the ring of a sale (CRM-04)', () => {
  const at = new Date('2026-11-03T10:00:00Z');
  const ago = (ms: number) => new Date(at.getTime() - ms);

  it('rings a sale recorded less than fifteen minutes after it happened, never a later one nor a refund', () => {
    expect(SALE_RING_WINDOW_MS).toBe(15 * 60_000);
    expect(ringsWhenRecorded({ event: 'sale', occurredAt: ago(SALE_RING_WINDOW_MS - 1) }, at)).toBe(true);
    expect(ringsWhenRecorded({ event: 'sale', occurredAt: ago(SALE_RING_WINDOW_MS) }, at)).toBe(false);
    expect(ringsWhenRecorded({ event: 'refund', occurredAt: ago(1000) }, at)).toBe(false);
    // A platform's clock a little ahead: still fresh.
    expect(ringsWhenRecorded({ event: 'sale', occurredAt: new Date(at.getTime() + 5000) }, at)).toBe(true);
  });
});
