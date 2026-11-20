import {
  CreatorEarningsSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  type CreatorSales,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorEarnings, periodRange, readableDay } from '../creator-earnings';

const fan = FanIdSchema.parse('0199f2a0-0000-7000-8000-000000000051');
const stranger = FanIdSchema.parse('0199f2a0-0000-7000-8000-000000000052');
const account = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-000000000011');

const line = (
  occurredAt: string,
  creatorMinor: number,
  patch: Partial<CreatorSales['lines'][number]> = {},
) => ({
  platform: 'reveal' as const,
  platformAccountId: account,
  event: 'sale' as const,
  saleType: 'ppv' as const,
  occurredAt,
  saleDay: occurredAt.slice(0, 10),
  currency: 'EUR' as const,
  grossInclVatMinor: 2000,
  grossExclVatMinor: 1667,
  netMinor: 1333,
  agencyMinor: 400,
  creatorMinor,
  fanId: fan,
  ...patch,
});

const row = (currency: 'EUR' | 'USD', creatorMinor: number, sales: number, refunds = 0) => ({
  day: '2026-11-03',
  platform: 'reveal' as const,
  platformAccountId: account,
  currency,
  saleType: 'ppv' as const,
  sales,
  refunds,
  grossInclVatMinor: 0,
  grossExclVatMinor: 0,
  netMinor: 0,
  agencyMinor: 0,
  creatorMinor,
});

describe('her Ventes (CR-04)', () => {
  it('finds the period of a day: the day, its fortnight, its month, leap February included', () => {
    expect(periodRange('day', '2026-11-20')).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(periodRange('fortnight', '2026-11-15')).toEqual({ from: '2026-11-01', to: '2026-11-15' });
    expect(periodRange('fortnight', '2026-11-16')).toEqual({ from: '2026-11-16', to: '2026-11-30' });
    expect(periodRange('fortnight', '2028-02-20')).toEqual({ from: '2028-02-16', to: '2028-02-29' });
    expect(periodRange('month', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('reads today and back, never ahead nor further than the reach', () => {
    expect(readableDay('2026-11-20', '2026-11-20', 400)).toBe(true);
    expect(readableDay('2026-11-21', '2026-11-20', 400)).toBe(false);
    expect(readableDay('2025-10-16', '2026-11-20', 400)).toBe(true);
    expect(readableDay('2025-10-15', '2026-11-20', 400)).toBe(false);
  });

  it('gives her part alone, per currency, refunds off, the newest line first with her fan by name', () => {
    const sales: CreatorSales = {
      from: '2026-11-01',
      to: '2026-11-15',
      rows: [row('EUR', 900, 2, 1), row('USD', 300, 1), row('EUR', 500, 1)],
      lines: [
        line('2026-11-03T10:00:00.000Z', 900),
        line('2026-11-03T12:00:00.000Z', 500, { event: 'refund', fanId: stranger }),
        line('2026-11-04T08:00:00.000Z', 300, { currency: 'USD', fanId: null, saleType: 'tip' }),
      ],
      refundsWithoutSale: 1,
    };
    const read = creatorEarnings(sales, {
      period: 'fortnight',
      today: '2026-11-20',
      names: new Map([[fan, 'Fan test']]),
    });
    expect(CreatorEarningsSchema.parse(read)).toEqual(read);
    expect(read.totals).toEqual([
      { currency: 'EUR', creatorMinor: 1400, sales: 3, refunds: 1 },
      { currency: 'USD', creatorMinor: 300, sales: 1, refunds: 0 },
    ]);
    expect(read.lines.map((one) => [one.occurredAt, one.event, one.fanName])).toEqual([
      ['2026-11-04T08:00:00.000Z', 'sale', null],
      ['2026-11-03T12:00:00.000Z', 'refund', null],
      ['2026-11-03T10:00:00.000Z', 'sale', 'Fan test'],
    ]);
    // Closed and gone by: no longer estimated, not the latest.
    expect([read.estimated, read.latest, read.refundsWithoutSale]).toEqual([false, false, 1]);
    expect(JSON.stringify(read)).not.toMatch(/gross|agency|net/u);
  });

  it('says a period under way estimated, and keeps the newest lines beyond the cap', () => {
    const many = Array.from({ length: 305 }, (_, i) =>
      line(new Date(Date.UTC(2026, 10, 20, 0, i)).toISOString(), 100),
    );
    const read = creatorEarnings(
      { from: '2026-11-16', to: '2026-11-30', rows: [], lines: many, refundsWithoutSale: 0 },
      { period: 'fortnight', today: '2026-11-20', names: new Map() },
    );
    expect([read.estimated, read.latest]).toEqual([true, true]);
    expect(read.lines).toHaveLength(300);
    expect(read.linesOmitted).toBe(5);
    expect(read.lines[0]?.occurredAt).toBe('2026-11-20T05:04:00.000Z');
  });
});
