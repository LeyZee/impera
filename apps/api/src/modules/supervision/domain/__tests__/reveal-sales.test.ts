import {
  DashboardRevealSalesSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type SaleSeller,
  type SalesTotals,
  type SalesTotalsRow,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { revealSalesPanel, salesDays } from '../reveal-sales';

// Everything below is invented (ADR 0010).
const ACCOUNT = newId(PlatformAccountIdSchema);
const THEO = newId(TeamMemberIdSchema);
const NORA = newId(TeamMemberIdSchema);
const NAMES = new Map([
  [THEO, 'Théo'],
  [NORA, 'Nora'],
]);

function row(seller: SaleSeller, patch: Partial<SalesTotalsRow> = {}): SalesTotalsRow {
  return {
    day: '2026-11-02',
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    currency: 'EUR',
    saleType: 'ppv',
    seller,
    sales: 1,
    refunds: 0,
    grossInclVatMinor: 1200,
    grossExclVatMinor: 1000,
    netMinor: 800,
    agencyMinor: 300,
    creatorMinor: 500,
    ...patch,
  };
}

const totals = (rows: SalesTotalsRow[], refundsWithoutSale = 0): SalesTotals => ({
  from: '2026-10-27',
  to: '2026-11-02',
  rows,
  refundsWithoutSale,
});

describe('the sales panel of the Dashboard (CRM-04 lot c)', () => {
  it('sums the platform’s amounts as they are, by seller in four kinds, the largest revenue first', () => {
    const panel = revealSalesPanel({
      totals: totals([
        row({ kind: 'member', memberId: THEO }),
        row({ kind: 'member', memberId: THEO }, { day: '2026-11-01', saleType: 'tip' }),
        row(
          { kind: 'agent' },
          {
            grossInclVatMinor: 3000,
            grossExclVatMinor: 2500,
            netMinor: 2000,
            agencyMinor: 800,
            creatorMinor: 1200,
          },
        ),
        row({ kind: 'unlinked' }),
        row(
          { kind: 'none' },
          {
            grossInclVatMinor: 600,
            grossExclVatMinor: 500,
            netMinor: 400,
            agencyMinor: 150,
            creatorMinor: 250,
          },
        ),
      ]),
      rate: null,
      names: NAMES,
    });
    expect(DashboardRevealSalesSchema.parse(panel)).toEqual(panel);
    expect(panel.totals).toEqual({
      sales: 5,
      refunds: 0,
      revenueMinor: 1200 + 1200 + 3000 + 1200 + 600,
      netMinor: 800 + 800 + 2000 + 800 + 400,
      agencyMinor: 300 + 300 + 800 + 300 + 150,
      creatorMinor: 500 + 500 + 1200 + 500 + 250,
    });
    expect(panel.bySeller?.map((line) => [line.seller, line.sales, line.revenueMinor])).toEqual([
      [{ kind: 'agent' }, 1, 3000],
      [{ kind: 'member', memberId: THEO, name: 'Théo' }, 2, 2400],
      [{ kind: 'unlinked' }, 1, 1200],
      [{ kind: 'none' }, 1, 600],
    ]);
  });

  it('takes a refund off, so a seller’s period can be negative, and counts the refunds older than the register apart', () => {
    const panel = revealSalesPanel({
      totals: totals(
        [
          row(
            { kind: 'member', memberId: NORA },
            {
              sales: 0,
              refunds: 1,
              grossInclVatMinor: -1200,
              grossExclVatMinor: -1000,
              netMinor: -800,
              agencyMinor: -300,
              creatorMinor: -500,
            },
          ),
        ],
        2,
      ),
      rate: null,
      names: NAMES,
    });
    expect(panel.totals).toMatchObject({ sales: 0, refunds: 1, revenueMinor: -1200, creatorMinor: -500 });
    expect(panel.bySeller?.[0]?.seller).toEqual({ kind: 'member', memberId: NORA, name: 'Nora' });
    expect(panel.refundsWithoutSale).toBe(2);
  });

  it('gives a chatter the totals and never who sold (ADR 0043 § 7)', () => {
    const panel = revealSalesPanel({
      totals: totals([row({ kind: 'member', memberId: THEO }), row({ kind: 'agent' })]),
      rate: null,
      names: null,
    });
    expect(panel.bySeller).toBeNull();
    expect(panel.totals).toMatchObject({ sales: 2, revenueMinor: 2400 });
    expect(JSON.stringify(panel)).not.toMatch(/Théo|agent|member/u);
  });

  it('names a member it cannot read « Membre inconnu », never an empty label', () => {
    const panel = revealSalesPanel({
      totals: totals([row({ kind: 'member', memberId: THEO })]),
      rate: null,
      names: new Map([[THEO, '  ']]),
    });
    expect(panel.bySeller?.[0]?.seller).toEqual({ kind: 'member', memberId: THEO, name: 'Membre inconnu' });
  });

  it('converts dollars once per seller at pay’s rate, a refund as its sale, and leaves them out without a rate', () => {
    const usd = [
      row(
        { kind: 'agent' },
        {
          currency: 'USD',
          grossInclVatMinor: 1001,
          grossExclVatMinor: 1001,
          netMinor: 1001,
          agencyMinor: 1001,
          creatorMinor: 0,
        },
      ),
      row(
        { kind: 'none' },
        {
          currency: 'USD',
          sales: 0,
          refunds: 1,
          grossInclVatMinor: -1001,
          grossExclVatMinor: -1001,
          netMinor: -1001,
          agencyMinor: -1001,
          creatorMinor: 0,
        },
      ),
    ];
    // 0,925 € for a dollar: 10,01 $ is 9,259 €, rounded to 9,26 €, the refund to −9,26 €.
    const rated = revealSalesPanel({
      totals: totals([row({ kind: 'agent' }), ...usd]),
      rate: { day: '2026-10-31', rateMicros: 925_000 },
      names: NAMES,
    });
    expect(rated.bySeller?.map((line) => [line.seller.kind, line.revenueMinor])).toEqual([
      ['agent', 1200 + 926],
      ['none', -926],
    ]);
    expect(rated.totals.revenueMinor).toBe(1200);
    expect(rated.usd).toEqual({ seen: true, rate: { day: '2026-10-31' } });

    const unrated = revealSalesPanel({
      totals: totals([row({ kind: 'agent' }), ...usd]),
      rate: null,
      names: NAMES,
    });
    expect(unrated.totals).toMatchObject({ sales: 1, refunds: 0, revenueMinor: 1200 });
    expect(unrated.bySeller?.map((line) => line.seller.kind)).toEqual(['agent']);
    expect(unrated.usd).toEqual({ seen: true, rate: null });
  });

  it('reaches back as far as the period control says, in her time zone', () => {
    // 23:30 UTC on 2 November is already the 3rd in Paris.
    const now = new Date('2026-11-02T23:30:00Z');
    expect(salesDays('day', now, 'Europe/Paris')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(salesDays('week', now, 'Europe/Paris')).toEqual({ from: '2026-10-28', to: '2026-11-03' });
    expect(salesDays('month', now, 'America/Montreal')).toEqual({ from: '2026-10-04', to: '2026-11-02' });
  });
});
