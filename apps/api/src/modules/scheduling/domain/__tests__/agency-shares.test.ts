import { PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { agencyShareGaps, type ShareTotalsRow } from '../agency-shares';

// Everything below is invented (ADR 0010): the accounts, the amounts and the percentages, never the agency's own.
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const OTHER = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a2');

function row(patch: Partial<ShareTotalsRow> & Pick<ShareTotalsRow, 'day'>): ShareTotalsRow {
  return {
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    currency: 'EUR',
    sales: 1,
    refunds: 0,
    netMinor: 10_000,
    creatorMinor: 6_500,
    ...patch,
  };
}

const AT_35 = [{ fromDay: '2026-10-01', agencyBps: 3500 }];

describe('the gap between her part on the platform and the agency’s percentage (CRM-04 d3)', () => {
  it('finds nothing when her part is the net less the percentage', () => {
    expect(agencyShareGaps([row({ day: '2026-10-20' }), row({ day: '2026-10-21' })], AT_35)).toEqual([]);
  });

  it('lets one cent per sale go, what rounding sale by sale explains', () => {
    // Three sales of 3,33 € at 35 %: the platform rounds each share, 2,16 € for her each time, 6,48 € in all, where the
    // whole net gives 6,4935 €. Within three cents: no gap.
    const rows = [row({ day: '2026-10-20', sales: 3, netMinor: 999, creatorMinor: 648 })];
    expect(agencyShareGaps(rows, AT_35)).toEqual([]);
    // Four cents off on three sales is more than rounding.
    const off = [row({ day: '2026-10-20', sales: 3, netMinor: 999, creatorMinor: 645 })];
    expect(agencyShareGaps(off, AT_35)).toEqual([
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        sales: 3,
        refunds: 0,
        creatorMinor: 645,
        expectedCreatorMinor: 649,
        differenceMinor: -4,
      },
    ]);
  });

  it('says the part read and the part the percentage gives when they differ', () => {
    const rows = [
      row({ day: '2026-10-20', creatorMinor: 7_000 }),
      row({ day: '2026-10-22', creatorMinor: 7_000 }),
    ];
    expect(agencyShareGaps(rows, AT_35)).toEqual([
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        sales: 2,
        refunds: 0,
        creatorMinor: 14_000,
        expectedCreatorMinor: 13_000,
        differenceMinor: 1_000,
      },
    ]);
  });

  it('lets one cent per refund go as well: a sale refunded, two roundings, no gap', () => {
    // The platform rounds the sale's part and its refund's each on its own side: up to a cent each, two in all, on a
    // day whose net is back to nothing.
    const refunded = [row({ day: '2026-10-20', sales: 1, refunds: 1, netMinor: 0, creatorMinor: 2 })];
    expect(agencyShareGaps(refunded, AT_35)).toEqual([]);
    // Three cents on one sale and its refund is more than rounding.
    const off = [row({ day: '2026-10-20', sales: 1, refunds: 1, netMinor: 0, creatorMinor: 3 })];
    expect(agencyShareGaps(off, AT_35)).toEqual([
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        sales: 1,
        refunds: 1,
        creatorMinor: 3,
        expectedCreatorMinor: 0,
        differenceMinor: 3,
      },
    ]);
  });

  it('reads each day with the percentage in force on it, a change in the middle of the fortnight included', () => {
    const rates = [
      { fromDay: '2026-10-01', agencyBps: 3000 },
      { fromDay: '2026-10-22', agencyBps: 3500 },
    ];
    const rows = [
      row({ day: '2026-10-20', creatorMinor: 7_000 }),
      row({ day: '2026-10-25', creatorMinor: 6_500 }),
    ];
    expect(agencyShareGaps(rows, rates)).toEqual([]);
    // The same days read with 35 % throughout differ.
    expect(agencyShareGaps(rows, AT_35)).toHaveLength(1);
  });

  it('compares no day before her first percentage, and nothing without one', () => {
    const rows = [row({ day: '2026-10-18', creatorMinor: 9_000 }), row({ day: '2026-10-25' })];
    expect(agencyShareGaps(rows, [{ fromDay: '2026-10-20', agencyBps: 3500 }])).toEqual([]);
    expect(agencyShareGaps(rows, [])).toEqual([]);
  });

  it('keeps each account and each currency apart', () => {
    const rows = [
      row({ day: '2026-10-20' }),
      row({ day: '2026-10-20', currency: 'USD', creatorMinor: 8_000 }),
      row({ day: '2026-10-20', platformAccountId: OTHER, creatorMinor: 6_000 }),
    ];
    expect(agencyShareGaps(rows, AT_35).map((gap) => [gap.platformAccountId, gap.currency])).toEqual([
      [ACCOUNT, 'USD'],
      [OTHER, 'EUR'],
    ]);
  });

  it('reads a refund taken off its sale’s day as the totals give it, both sides alike', () => {
    // A day whose only sale was refunded: nothing left on either side.
    const refunded = [row({ day: '2026-10-20', sales: 1, refunds: 1, netMinor: 0, creatorMinor: 0 })];
    expect(agencyShareGaps(refunded, AT_35)).toEqual([]);
    // A refund of a sale whose part was off: the gap goes with the sale, negative amounts rounded the same way.
    const negative = [row({ day: '2026-10-20', sales: 0, refunds: 1, netMinor: -1_001, creatorMinor: -500 })];
    expect(agencyShareGaps(negative, AT_35)).toEqual([
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        sales: 0,
        refunds: 1,
        creatorMinor: -500,
        expectedCreatorMinor: -651,
        differenceMinor: 151,
      },
    ]);
  });
});
