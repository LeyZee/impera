import {
  CreatorEarningsSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  type CreatorSales,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorEarnings, periodRange, readableDay, shareBp } from '../creator-earnings';

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

/** Invented amounts: a row whose path ends in `creatorMinor`, the agency taking a third of the net. */
const row = (currency: 'EUR' | 'USD', creatorMinor: number, sales: number, refunds = 0) => ({
  day: '2026-11-03',
  platform: 'reveal' as const,
  platformAccountId: account,
  currency,
  saleType: 'ppv' as const,
  sales,
  refunds,
  grossInclVatMinor: creatorMinor * 2,
  grossExclVatMinor: Math.round((creatorMinor * 2) / 1.2),
  netMinor: (creatorMinor * 3) / 2,
  agencyMinor: creatorMinor / 2,
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

  it('gives the whole path of her sales, per currency, refunds off, the newest line first with her fan by name', () => {
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
      {
        currency: 'EUR',
        sales: 3,
        refunds: 1,
        grossInclVatMinor: 2800,
        grossExclVatMinor: 1500 + 833,
        netMinor: 2100,
        agencyMinor: 700,
        creatorMinor: 1400,
        shareOfNetBp: 6667,
        agencyShareOfNetBp: 3333,
        shareOfPaidBp: 5000,
      },
      {
        currency: 'USD',
        sales: 1,
        refunds: 0,
        grossInclVatMinor: 600,
        grossExclVatMinor: 500,
        netMinor: 450,
        agencyMinor: 150,
        creatorMinor: 300,
        shareOfNetBp: 6667,
        agencyShareOfNetBp: 3333,
        shareOfPaidBp: 5000,
      },
    ]);
    expect(read.lines.map((one) => [one.occurredAt, one.event, one.fanName])).toEqual([
      ['2026-11-04T08:00:00.000Z', 'sale', null],
      ['2026-11-03T12:00:00.000Z', 'refund', null],
      ['2026-11-03T10:00:00.000Z', 'sale', 'Fan test'],
    ]);
    // Closed and gone by: no longer estimated, not the latest.
    expect([read.estimated, read.latest, read.refundsWithoutSale]).toEqual([false, false, 1]);
    expect(read.lines[2]).toMatchObject({ saleDay: '2026-11-03', netMinor: 1333, agencyMinor: 400 });
    expect(read.lines[2]?.shareOfNetBp).toBe(shareBp(900, 1333));
  });

  it('sends the keys of the path and nothing else: no seller, source, shift nor member (ADR 0157 § 6)', () => {
    const read = creatorEarnings(
      {
        from: '2026-11-03',
        to: '2026-11-03',
        rows: [row('EUR', 900, 1)],
        lines: [line('2026-11-03T10:00:00.000Z', 900)],
        refundsWithoutSale: 0,
      },
      { period: 'day', today: '2026-11-20', names: new Map() },
    );
    expect(Object.keys(read).sort()).toEqual([
      'estimated',
      'from',
      'latest',
      'lines',
      'linesOmitted',
      'period',
      'refundsWithoutSale',
      'to',
      'totals',
    ]);
    expect(Object.keys(read.totals[0] ?? {}).sort()).toEqual([
      'agencyMinor',
      'agencyShareOfNetBp',
      'creatorMinor',
      'currency',
      'grossExclVatMinor',
      'grossInclVatMinor',
      'netMinor',
      'refunds',
      'sales',
      'shareOfNetBp',
      'shareOfPaidBp',
    ]);
    expect(Object.keys(read.lines[0] ?? {}).sort()).toEqual([
      'agencyMinor',
      'creatorMinor',
      'currency',
      'event',
      'fanName',
      'grossExclVatMinor',
      'grossInclVatMinor',
      'netMinor',
      'occurredAt',
      'saleDay',
      'saleType',
      'shareOfNetBp',
    ]);
  });

  it('computes a share on sums only, a dash when the base is nil', () => {
    expect(shareBp(900, 1350)).toBe(6667);
    expect(shareBp(0, 1350)).toBe(0);
    expect(shareBp(500, 0)).toBeNull();
    // A period whose refunds outweigh its sales has no share to tell.
    expect(shareBp(-200, -300)).toBeNull();
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
