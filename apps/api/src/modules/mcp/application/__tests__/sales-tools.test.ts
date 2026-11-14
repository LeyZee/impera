import {
  CreatorIdSchema,
  McpGrantIdSchema,
  McpSalesInputSchema,
  McpSalesListSchema,
  newId,
  PlatformAccountIdSchema,
  SalesOfCreatorSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type CreatorId,
  type SalesOfCreator,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ActorView } from '../../domain/access';
import type { CreatorReader, GrantRecord, SalesReader } from '../../domain/ports';
import { salesTools } from '../sales-tools';

const nora = newId(CreatorIdSchema);
const lea = newId(CreatorIdSchema);
const account = newId(PlatformAccountIdSchema);
const otherAccount = newId(PlatformAccountIdSchema);
const lou = newId(TeamMemberIdSchema);
const sam = newId(TeamMemberIdSchema);
const grant: GrantRecord = {
  id: newId(McpGrantIdSchema),
  userId: newId(UserIdSchema),
  creatorId: null,
  label: 'Agent inventé',
  capabilities: ['read:sales'],
  createdAt: new Date('2026-11-14T10:00:00.000Z'),
  expiresAt: new Date('2026-12-14T10:00:00.000Z'),
  lastUsedAt: null,
  revokedAt: null,
};
const owner: ActorView = {
  role: 'owner',
  teamScope: 'owner',
  secondFactorEnabled: true,
  readableCreatorIds: 'all',
};
const manager: ActorView = { ...owner, role: 'operator', teamScope: 'agency', readableCreatorIds: [lea] };
const week = { from: '2026-11-01', to: '2026-11-07' };

const line = (over: Record<string, unknown>) => ({
  day: '2026-11-02',
  platform: 'reveal',
  platformAccountId: account,
  currency: 'EUR',
  saleType: 'ppv',
  seller: { kind: 'member', memberId: lou },
  sales: 1,
  refunds: 0,
  grossInclVatMinor: 1200,
  grossExclVatMinor: 1000,
  netMinor: 800,
  ...over,
});

/** Lou sold twice and Sam once the same day, on two accounts; the agent once; a tip another day. */
const read: SalesOfCreator = SalesOfCreatorSchema.parse({
  creatorId: lea,
  from: week.from,
  to: week.to,
  rows: [
    line({}),
    line({
      platformAccountId: otherAccount,
      sales: 1,
      grossInclVatMinor: 2400,
      grossExclVatMinor: 2000,
      netMinor: 1600,
    }),
    line({
      seller: { kind: 'member', memberId: sam },
      sales: 1,
      refunds: 1,
      grossInclVatMinor: 0,
      grossExclVatMinor: 0,
      netMinor: 0,
    }),
    line({ seller: { kind: 'agent' } }),
    line({
      day: '2026-11-01',
      saleType: 'tip',
      seller: { kind: 'none' },
      grossInclVatMinor: 500,
      grossExclVatMinor: 417,
      netMinor: 333,
    }),
  ],
  refundsWithoutSale: 2,
  readings: [{ platform: 'reveal', readAt: '2026-11-07T23:00:00.000Z', pausedUntil: null }],
});

function sources(): {
  sales: SalesReader & { asked: [string, readonly CreatorId[], { from: string; to: string }][] };
  creators: CreatorReader & { asked: (readonly CreatorId[] | 'all')[] };
} {
  const salesAsked: [string, readonly CreatorId[], { from: string; to: string }][] = [];
  const creatorsAsked: (readonly CreatorId[] | 'all')[] = [];
  return {
    sales: {
      asked: salesAsked,
      sales: (userId, creatorIds, range) => {
        salesAsked.push([userId, creatorIds, range]);
        // What the connectors give besides, never copied: the shares and a rate.
        return Promise.resolve([
          { ...read, ...{ agencyMinor: 300, creatorMinor: 500, rateBasisPoints: 2000 } },
        ]);
      },
    },
    creators: {
      asked: creatorsAsked,
      unarchived: (ids) => {
        creatorsAsked.push(ids);
        return Promise.resolve(
          (ids === 'all' ? [nora, lea] : ids).map((id) => ({
            id,
            displayName: 'Inventée',
            timezone: 'Europe/Paris',
          })),
        );
      },
    },
  };
}

describe('sales_list (ADR 0105 § 3 and § 4, read:sales, decision A)', () => {
  it('reads as the access’s person: its creator, else the unarchived ones the person reads now', async () => {
    const { sales, creators } = sources();
    const tool = salesTools(sales, creators)['sales_list'];
    if (tool === undefined) throw new Error('no sales_list');
    await tool.run({ grant, actor: manager, creatorId: nora }, week);
    await tool.run({ grant, actor: manager, creatorId: null }, week);
    await tool.run({ grant, actor: owner, creatorId: null }, week);
    expect(creators.asked).toEqual([[lea], 'all']);
    expect(sales.asked).toEqual([
      [grant.userId, [nora], week],
      [grant.userId, [lea], week],
      [grant.userId, [nora, lea], week],
    ]);
  });

  it('sums every seller and account by day, platform, currency and kind', async () => {
    const { sales, creators } = sources();
    const tool = salesTools(sales, creators)['sales_list'];
    if (tool === undefined) throw new Error('no sales_list');
    const value = McpSalesListSchema.parse(await tool.run({ grant, actor: owner, creatorId: lea }, week));
    expect(value).toEqual({
      from: week.from,
      to: week.to,
      creators: [
        {
          creatorId: lea,
          rows: [
            {
              day: '2026-11-01',
              platform: 'reveal',
              currency: 'EUR',
              saleType: 'tip',
              sales: 1,
              refunds: 0,
              grossInclVatMinor: 500,
              grossExclVatMinor: 417,
              netMinor: 333,
            },
            {
              day: '2026-11-02',
              platform: 'reveal',
              currency: 'EUR',
              saleType: 'ppv',
              sales: 4,
              refunds: 1,
              grossInclVatMinor: 4800,
              grossExclVatMinor: 4000,
              netMinor: 3200,
            },
          ],
          refundsWithoutSale: 2,
          readings: [{ platform: 'reveal', readAt: '2026-11-07T23:00:00.000Z', pausedUntil: null }],
        },
      ],
    });
  });

  it('gives no seller, member, account, share nor rate: no amount per member can be read from it', async () => {
    const { sales, creators } = sources();
    const tool = salesTools(sales, creators)['sales_list'];
    if (tool === undefined) throw new Error('no sales_list');
    const text = JSON.stringify(await tool.run({ grant, actor: owner, creatorId: lea }, week));
    for (const leak of [
      lou,
      sam,
      account,
      otherAccount,
      'seller',
      'member',
      'agent',
      'agencyMinor',
      'creatorMinor',
      'rate',
    ])
      expect(text).not.toContain(leak);
    // Lou's own amounts (800 and 1600 net) never stand alone: only the day's sum over every seller does.
    expect(text).not.toMatch(/"netMinor":(800|1600),/u);
  });

  it('refuses a period backwards or longer than the connectors read', () => {
    expect(McpSalesInputSchema.safeParse(week).success).toBe(true);
    expect(McpSalesInputSchema.safeParse({ from: week.to, to: week.from }).success).toBe(false);
    expect(McpSalesInputSchema.safeParse({ from: '2026-08-01', to: '2026-11-01' }).success).toBe(true);
    expect(McpSalesInputSchema.safeParse({ from: '2026-08-01', to: '2026-11-02' }).success).toBe(false);
    expect(McpSalesInputSchema.safeParse({ ...week, seller: 'x' }).success).toBe(false);
  });
});
