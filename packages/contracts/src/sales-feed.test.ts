import { describe, expect, it } from 'vitest';

import { newId, PlatformAccountIdSchema, TeamMemberIdSchema } from './ids';
import { SaleSellerSchema, SalesTotalsSchema } from './sales-feed';

// Everything below is invented (ADR 0010).
const ROW = {
  day: '2026-10-25',
  platform: 'reveal',
  platformAccountId: newId(PlatformAccountIdSchema),
  currency: 'EUR',
  saleType: 'ppv',
  seller: { kind: 'member', memberId: newId(TeamMemberIdSchema) },
  sales: 1,
  refunds: 1,
  grossInclVatMinor: 0,
  grossExclVatMinor: 0,
  netMinor: 0,
  agencyMinor: 0,
  creatorMinor: 0,
};

describe('sales totals (CRM-04)', () => {
  it('takes a refund off, so an amount can be negative, never a count', () => {
    const totals = { from: '2026-10-01', to: '2026-10-31', rows: [ROW], refundsWithoutSale: 0 };
    expect(SalesTotalsSchema.parse(totals)).toEqual(totals);
    const refundOnly = { ...ROW, sales: 0, grossInclVatMinor: -1200, creatorMinor: -500 };
    expect(SalesTotalsSchema.safeParse({ ...totals, rows: [refundOnly] }).success).toBe(true);
    for (const patch of [
      { sales: -1 },
      { refunds: 0.5 },
      { day: '2026-10-25T10:00:00Z' },
      { creatorMinor: 1.5 },
    ]) {
      expect(
        SalesTotalsSchema.safeParse({ ...totals, rows: [{ ...ROW, ...patch }] }).success,
        JSON.stringify(patch),
      ).toBe(false);
    }
  });

  it('names a seller in four kinds, a member by his id only', () => {
    for (const kind of ['agent', 'unlinked', 'none'])
      expect(SaleSellerSchema.parse({ kind })).toEqual({ kind });
    expect(SaleSellerSchema.safeParse({ kind: 'member' }).success).toBe(false);
    // A name handed over is dropped: the seller never carries one.
    const memberId = newId(TeamMemberIdSchema);
    expect(SaleSellerSchema.parse({ kind: 'member', memberId, name: 'Théo' })).toEqual({
      kind: 'member',
      memberId,
    });
  });
});
