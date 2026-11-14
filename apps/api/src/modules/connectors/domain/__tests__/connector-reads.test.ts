import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineSchema,
  TeamMemberIdSchema,
  type SalesTotals,
  type SalesTotalsRow,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  distinctCreators,
  MAX_READ_DAYS,
  readableRange,
  readsCreatorFigures,
  salesByChatterOf,
  salesLinesOf,
  teamImportLinkedOf,
} from '../connector-reads';
import type { TeamImportContext } from '../team-import';

// Everything below is invented (ADR 0010).
const ACCOUNT = newId(PlatformAccountIdSchema);
const THEO = newId(TeamMemberIdSchema);
const MAYA = newId(TeamMemberIdSchema);

function row(overrides: Partial<SalesTotalsRow> = {}): SalesTotalsRow {
  return {
    day: '2026-10-05',
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    currency: 'EUR',
    saleType: 'ppv',
    seller: { kind: 'member', memberId: THEO },
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

const totals = (rows: SalesTotalsRow[]): SalesTotals => ({
  from: '2026-10-01',
  to: '2026-10-31',
  rows,
  refundsWithoutSale: 0,
});

describe('who reads a creator’s figures through the connectors (ADR 0026 § 1)', () => {
  it('is the owner, or an active manager for the creators of his list, nobody else', () => {
    expect(readsCreatorFigures({ scope: 'owner', onList: false })).toBe(true);
    expect(readsCreatorFigures({ scope: 'agency', onList: true })).toBe(true);
    expect(readsCreatorFigures({ scope: 'agency', onList: false })).toBe(false);
    expect(readsCreatorFigures({ scope: 'self', onList: true })).toBe(false);
  });

  it('reads a creator named twice once, in the order asked', () => {
    const [a, b] = [newId(CreatorIdSchema), newId(CreatorIdSchema)];
    expect(distinctCreators([a, b, a])).toEqual([a, b]);
  });
});

describe('the period of a read', () => {
  it('takes days in order, real dates, at most a quarter and a few days', () => {
    expect(readableRange({ from: '2026-10-01', to: '2026-10-01' })).toBe(true);
    expect(readableRange({ from: '2026-08-01', to: '2026-11-01' })).toBe(true);
    expect(readableRange({ from: '2026-10-31', to: '2026-10-01' })).toBe(false);
    expect(readableRange({ from: '2026-02-30', to: '2026-03-01' })).toBe(false);
    expect(readableRange({ from: '2026-10-01T00:00', to: '2026-10-02' })).toBe(false);
    const last = new Date(Date.parse('2026-01-01T00:00:00Z') + (MAX_READ_DAYS - 1) * 86_400_000);
    expect(readableRange({ from: '2026-01-01', to: last.toISOString().slice(0, 10) })).toBe(true);
    const over = new Date(Date.parse('2026-01-01T00:00:00Z') + MAX_READ_DAYS * 86_400_000);
    expect(readableRange({ from: '2026-01-01', to: over.toISOString().slice(0, 10) })).toBe(false);
  });
});

describe('the sales without the shares (ADR 0105 § 3)', () => {
  it('keeps the platform’s amounts and drops the agency’s and the creator’s share', () => {
    const [line] = salesLinesOf(totals([row()]));
    expect(line).toEqual({
      day: '2026-10-05',
      platform: 'reveal',
      platformAccountId: ACCOUNT,
      currency: 'EUR',
      saleType: 'ppv',
      seller: { kind: 'member', memberId: THEO },
      sales: 1,
      refunds: 0,
      grossInclVatMinor: 1200,
      grossExclVatMinor: 1000,
      netMinor: 800,
    });
    // The contract refuses a share outright: a line that kept one would not leave the module.
    expect(SalesLineSchema.safeParse({ ...line, agencyMinor: 300 }).success).toBe(false);
  });

  it('sums the period by seller, platform and currency, the net first, with the member’s name', () => {
    const rows = salesByChatterOf(
      totals([
        row(),
        row({
          day: '2026-10-06',
          sales: 1,
          refunds: 1,
          grossInclVatMinor: 0,
          grossExclVatMinor: 0,
          netMinor: 0,
        }),
        row({ seller: { kind: 'agent' }, grossInclVatMinor: 3000, grossExclVatMinor: 2500, netMinor: 2000 }),
        row({ seller: { kind: 'member', memberId: MAYA }, currency: 'USD', netMinor: 100 }),
        row({ seller: { kind: 'none' }, netMinor: 50 }),
      ]),
      new Map([[THEO, 'Théo']]),
    );
    expect(
      rows.map((one) => [
        one.currency,
        one.seller.kind,
        one.sellerDisplayName,
        one.sales,
        one.refunds,
        one.netMinor,
      ]),
    ).toEqual([
      ['EUR', 'agent', null, 1, 0, 2000],
      ['EUR', 'member', 'Théo', 2, 1, 800],
      ['EUR', 'none', null, 1, 0, 50],
      // A member gone from the names reads no name, never someone else's.
      ['USD', 'member', null, 1, 0, 100],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/agency|creatorMinor/iu);
  });
});

describe('the imported team as the base keeps it (ADR 0076)', () => {
  it('lists each linked account with its member’s name and whether the platform removed it', () => {
    const context: TeamImportContext = {
      viewer: { kind: 'owner' },
      members: [
        {
          memberId: THEO,
          displayName: 'Théo',
          firstName: 'Prénom',
          lastName: 'Inventé',
          email: 'theo@example.test',
          leftOn: null,
          creatorIds: [],
        },
      ],
      links: new Map([
        ['chatter_theo', { kind: 'member', memberId: THEO }],
        ['bot_test_01', { kind: 'agent' }],
      ]),
      reviews: new Map([
        [
          'chatter_theo',
          {
            decision: null,
            decidedAt: null,
            platformRemovedAt: new Date('2026-10-10T00:00:00Z'),
            absentSince: null,
            isBot: false,
          },
        ],
      ]),
      modelCreators: new Map(),
      creatorNames: new Map(),
      abnormalRead: false,
    };
    const linked = teamImportLinkedOf(
      context,
      { newCount: 2, removalCount: 1, abnormalRead: false },
      'reveal',
    );
    expect(linked).toEqual({
      platform: 'reveal',
      accounts: [
        { platformChatterId: 'bot_test_01', link: { kind: 'agent' }, removed: false },
        {
          platformChatterId: 'chatter_theo',
          link: { kind: 'member', memberId: THEO, memberDisplayName: 'Théo' },
          removed: true,
        },
      ],
      newCount: 2,
      removalCount: 1,
      abnormalRead: false,
    });
    // The members' e-mails stay in the review: never in this read.
    expect(JSON.stringify(linked)).not.toMatch(/example\.test/u);
  });
});
