import {
  CreatorIdSchema,
  DomainError,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ConnectorReadsStore, CreatorSalesRead } from '../../domain/connector-reads';
import { createConnectorReads, type ConnectorReadsDeps } from '../connector-reads';

// Everything below is invented (ADR 0010).
const NORA = newId(CreatorIdSchema);
const LEA = newId(CreatorIdSchema);
const THEO = newId(TeamMemberIdSchema);
const RANGE = { from: '2026-10-01', to: '2026-10-31' };

const read: CreatorSalesRead = {
  totals: {
    from: RANGE.from,
    to: RANGE.to,
    rows: [
      {
        day: '2026-10-05',
        platform: 'reveal',
        platformAccountId: newId(PlatformAccountIdSchema),
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
      },
    ],
    refundsWithoutSale: 0,
  },
  readings: [{ platform: 'reveal', readAt: '2026-10-31T04:00:00.000Z', pausedUntil: null }],
  names: new Map([[THEO, 'Théo']]),
};

/** A store where the reader reads `allowed` only, and that counts what it was asked. */
function storeFor(allowed: readonly CreatorId[]) {
  const asked: CreatorId[] = [];
  const store: ConnectorReadsStore = {
    sales: (_userId, creatorId) => {
      asked.push(creatorId);
      return Promise.resolve(allowed.includes(creatorId) ? read : null);
    },
    dailyStats: (_userId, creatorId) => {
      asked.push(creatorId);
      return Promise.resolve(allowed.includes(creatorId) ? [] : null);
    },
  };
  const team: ConnectorReadsDeps['team'] = {
    context: () => Promise.resolve(null),
    counts: () => Promise.resolve(null),
  };
  return { reads: createConnectorReads({ store, team }), asked };
}

const codeOf = (promise: Promise<unknown>): Promise<string | null> =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof DomainError ? error.code : 'not a domain error'),
  );

describe('the connectors’ reads for another module (ADR 0026 § 1)', () => {
  it('gives each creator’s sales without either share', async () => {
    const { reads } = storeFor([NORA]);
    const [nora] = await reads.sales('user_test', [NORA], RANGE);
    expect(nora?.rows[0]).not.toHaveProperty('agencyMinor');
    expect(nora?.rows[0]).not.toHaveProperty('creatorMinor');
    const [byChatter] = await reads.salesByChatter('user_test', [NORA], RANGE);
    expect(byChatter?.rows.map((row) => [row.sellerDisplayName, row.netMinor])).toEqual([['Théo', 800]]);
  });

  it('refuses the whole call when one creator is refused, and stops reading there', async () => {
    const { reads, asked } = storeFor([NORA]);
    expect(await codeOf(reads.sales('user_test', [LEA, NORA], RANGE))).toBe('connector_reads_forbidden');
    expect(asked).toEqual([LEA]);
  });

  it('reads a creator named twice once', async () => {
    const { reads, asked } = storeFor([NORA]);
    expect(await reads.dailyStats('user_test', [NORA, NORA], RANGE)).toHaveLength(1);
    expect(asked).toEqual([NORA]);
  });

  it('refuses a period it cannot read before asking the base anything', async () => {
    const { reads, asked } = storeFor([NORA]);
    expect(await codeOf(reads.sales('user_test', [NORA], { from: '2026-10-31', to: '2026-10-01' }))).toBe(
      'connector_reads_range_unprocessable',
    );
    expect(
      await codeOf(reads.dailyStats('user_test', [NORA], { from: '2026-01-01', to: '2026-12-31' })),
    ).toBe('connector_reads_range_unprocessable');
    expect(asked).toEqual([]);
  });

  it('refuses the imported team to anyone the review refuses', async () => {
    const { reads } = storeFor([NORA]);
    expect(await codeOf(reads.teamImport('user_test', 'reveal'))).toBe('sales_feed_team_forbidden');
  });
});
