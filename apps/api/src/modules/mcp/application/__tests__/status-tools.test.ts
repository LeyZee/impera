import {
  AgencyInsightsSchema,
  AiUsageSchema,
  CreatorIdSchema,
  McpAiUsageSchema,
  McpGrantIdSchema,
  McpStatsSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
  type AgencyInsights,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ActorView } from '../../domain/access';
import { McpReadRefused } from '../../domain/errors';
import type { GrantRecord, StatsReader } from '../../domain/ports';
import { statusTools } from '../status-tools';

const grant: GrantRecord = {
  id: newId(McpGrantIdSchema),
  userId: newId(UserIdSchema),
  creatorId: null,
  label: 'Agent inventé',
  capabilities: ['read:status'],
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

const usage = AiUsageSchema.parse({
  readAt: '2026-11-14T10:00:00.000Z',
  timeZone: 'Europe/Paris',
  usdPerEur: 1.08,
  today: {
    day: '2026-11-14',
    eur: 3.2,
    coveredEur: 0,
    capEur: 20,
    alertAtEur: 16,
    state: 'ok',
    calls: 120,
    failed: 2,
  },
  hours: [],
  days: [
    {
      day: '2026-11-14',
      eur: 3.2,
      coveredEur: 0,
      calls: 120,
      providers: [{ provider: 'xai', eur: 3.2, coveredEur: 0 }],
    },
  ],
  models: [],
  uses: [],
  pace: {
    perDayEur: 4.1,
    perDayOver: 7,
    monthEur: 52.3,
    monthCoveredEur: 0,
    monthForecastEur: 118,
    monthForecastCoveredEur: 0,
    month: '2026-11',
  },
  lastCallAt: '2026-11-14T09:58:00.000Z',
  credits: [],
  voice: null,
});

const noStats: StatsReader = { agencyInsights: () => Promise.reject(new Error('not read here')) };

/** JSON numbers in value position: an id that holds the same digits never counts. */
const numbersIn = (value: unknown): number[] =>
  (JSON.stringify(value).match(/(?<=[:,[])-?\d+(?:\.\d+)?(?=[,\]}])/gu) ?? []).map(Number);

/** Invented creators and amounts only (ADR 0010); the shares and the seller's amounts are numbers seen nowhere else. */
const [ines, mara] = [newId(CreatorIdSchema), newId(CreatorIdSchema)];
const SHARES = [700_001, 700_002, 700_003, 700_004, 700_005, 700_006] as const;
const SELLER = [910_001, 910_002, 910_003, 910_004] as const;
const figures = (revenue: number, agency: number, creator: number, vat: number) => ({
  revenueMinor: revenue,
  revenueExclVatMinor: revenue - 100,
  netMinor: revenue - 2_000,
  agencyMinor: agency,
  creatorMinor: creator,
  agencyTransferVatMinor: vat,
  sales: 4,
  refunds: 1,
});
const subscriberFigures = {
  activeAtEnd: 120,
  activeBefore: 110,
  newSubscribers: 12,
  unsubscribes: 2,
  renewals: null,
  ppvSent: 30,
  ppvPurchased: 6,
  messagesSent: null,
  messagesReceived: 80,
  daysRead: 7,
  days: 7,
};
const insights: AgencyInsights = AgencyInsightsSchema.parse({
  period: 'week',
  span: { unit: 'rolling', partial: false, end: '2026-11-16', compare: 'previous', today: '2026-11-16' },
  from: '2026-11-10',
  to: '2026-11-16',
  previousFrom: '2026-11-03',
  previousTo: '2026-11-09',
  registerSince: '2026-10-01',
  previousDays: [],
  creators: [
    { creatorId: ines, name: 'Inès Inventée' },
    { creatorId: mara, name: 'Mara Inventée' },
  ],
  totals: {
    current: figures(50_000, SHARES[0], SHARES[1], SHARES[2]),
    previous: figures(40_000, SHARES[3], SHARES[4], SHARES[5]),
  },
  days: [
    {
      day: '2026-11-16',
      revenueMinor: 3_000,
      agencyMinor: 700_007,
      creatorMinor: 700_008,
      byCreator: [{ creatorId: ines, revenueMinor: 3_000 }],
      byKind: [{ kind: 'ppv', revenueMinor: 3_000 }],
    },
  ],
  kinds: [{ kind: 'ppv', revenueMinor: 30_000, sales: 3, previousRevenueMinor: 20_000 }],
  sellers: [
    {
      ...figures(SELLER[0], SELLER[1], SELLER[2], SELLER[3]),
      seller: { kind: 'member', memberId: newId(TeamMemberIdSchema), name: 'Chatteur Inventé' },
      previousRevenueMinor: 910_005,
    },
  ],
  byCreator: [
    { creatorId: ines, ...figures(50_000, SHARES[0], SHARES[1], SHARES[2]), previousRevenueMinor: 40_000 },
  ],
  hours: Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => (d === 0 && h === 21 ? 3_000 : 0)),
  ),
  hourly: [],
  fans: { paying: 9, previousPaying: 7, newPaying: 2, topTenShare: 85, averagePerPayingMinor: 5_555 },
  // A refund and the chatter of its sale (ADR 0092 § 4): the screen's alone, never the MCP's (ADR 0144).
  refundList: [
    {
      refundedAt: '2026-11-16T09:00:00.000Z',
      creatorId: ines,
      kind: 'ppv',
      amountMinor: 777_001,
      seller: { kind: 'member', memberId: newId(TeamMemberIdSchema), name: 'Chatteur Remboursé' },
      delayDays: 3,
    },
  ],
  refundsWithoutSale: 0,
  timeZone: 'Europe/Paris',
  dollarsLeftOut: false,
  subscribers: {
    current: subscriberFigures,
    previous: subscriberFigures,
    days: [{ day: '2026-11-16', active: 120 }],
    readAt: '2026-11-16T07:00:00.000Z',
  },
});
const manager: ActorView = {
  role: 'operator',
  teamScope: 'agency',
  secondFactorEnabled: true,
  readableCreatorIds: [ines],
};

describe('stats_get (ADR 0026 § 5, ADR 0078, decision A of 14/11)', () => {
  const statsOf = (read: StatsReader['agencyInsights']) => {
    const tool = statusTools(
      { read: () => Promise.reject(new Error('not read here')) },
      { agencyInsights: read },
    )['stats_get'];
    if (tool === undefined) throw new Error('no stats_get');
    return tool;
  };

  it('reads as the person, his list for a manager, and gives the figures without a share nor a seller', async () => {
    const asked: unknown[] = [];
    const tool = statsOf((reader, period, creatorId) => {
      asked.push({ reader, period, creatorId });
      return Promise.resolve(insights);
    });
    const out = McpStatsSchema.parse(
      await tool.run({ grant, actor: manager, creatorId: null }, { period: 'week' }),
    );
    expect(asked).toEqual([
      {
        reader: { userId: grant.userId, role: 'operator', creatorIds: [ines] },
        period: 'week',
        creatorId: undefined,
      },
    ]);
    expect(out.totals.current).toEqual({
      revenueMinor: 50_000,
      revenueExclVatMinor: 49_900,
      netMinor: 48_000,
      sales: 4,
      refunds: 1,
    });
    expect(out.byCreator).toEqual([
      {
        creatorId: ines,
        revenueMinor: 50_000,
        revenueExclVatMinor: 49_900,
        netMinor: 48_000,
        sales: 4,
        refunds: 1,
        previousRevenueMinor: 40_000,
      },
    ]);
    expect(out.fans).toEqual(insights.fans);
    expect(out.subscribers?.current).toEqual(subscriberFigures);
    const text = JSON.stringify(out);
    for (const key of [
      'agencyMinor',
      'creatorMinor',
      'agencyTransferVatMinor',
      'sellers',
      'seller',
      'memberId',
      'refundList',
      'delayDays',
    ])
      expect(text).not.toContain(`"${key}"`);
    expect(text).not.toContain('Chatteur Inventé');
    expect(text).not.toContain('Chatteur Remboursé');
    for (const amount of [...SHARES, 700_007, 700_008, ...SELLER, 910_005, 777_001])
      expect(numbersIn(out)).not.toContain(amount);
  });

  it('reads every creator for the owner', async () => {
    const asked: unknown[] = [];
    const tool = statsOf((reader) => {
      asked.push(reader.creatorIds);
      return Promise.resolve(insights);
    });
    await tool.run({ grant, actor: owner, creatorId: null }, { period: 'day' });
    expect(asked).toEqual([[]]);
  });

  it('confines an access bound to a creator to her figures', async () => {
    const asked: unknown[] = [];
    const tool = statsOf((_reader, _period, creatorId) => {
      asked.push(creatorId);
      return Promise.resolve(insights);
    });
    await tool.run(
      { grant: { ...grant, creatorId: ines }, actor: owner, creatorId: ines },
      { period: 'week' },
    );
    await tool.run({ grant, actor: owner, creatorId: null }, { period: 'week' });
    expect(asked).toEqual([ines, undefined]);
  });

  it('refuses whoever the Dashboard refuses, never an empty answer', async () => {
    const tool = statsOf(() => Promise.resolve(null));
    await expect(tool.run({ grant, actor: manager, creatorId: null }, { period: 'week' })).rejects.toEqual(
      new McpReadRefused('role_forbidden'),
    );
  });

  it('lets no field the screen gains one day leave, and asks for a period', () => {
    const tool = statsOf(() => Promise.resolve(insights));
    expect(tool.input.safeParse({}).success).toBe(false);
    expect(tool.input.safeParse({ period: 'year' }).success).toBe(false);
    expect(tool.input.safeParse({ period: 'week', creatorId: ines }).success).toBe(false);
    // The screen's whole answer, shares and sellers in it, is not an answer of the tool.
    expect(McpStatsSchema.safeParse(insights).success).toBe(false);
  });
});

describe('ai_usage_get (ADR 0091, ADR 0105 § 4)', () => {
  it('gives the spend as the screen shows it, never a balance nor a key', async () => {
    const tool = statusTools({ read: () => Promise.resolve(usage) }, noStats)['ai_usage_get'];
    if (tool === undefined) throw new Error('no ai_usage_get');
    const value = McpAiUsageSchema.parse(await tool.run({ grant, actor: owner, creatorId: null }, {}));
    expect(value).toEqual({
      readAt: '2026-11-14T10:00:00.000Z',
      today: { day: '2026-11-14', eur: 3.2, capEur: 20, alertAtEur: 16, state: 'ok', calls: 120, failed: 2 },
      days: [{ day: '2026-11-14', eur: 3.2, calls: 120 }],
      pace: { perDayEur: 4.1, perDayOver: 7, monthEur: 52.3, monthForecastEur: 118, month: '2026-11' },
      lastCallAt: '2026-11-14T09:58:00.000Z',
    });
    expect(Object.keys(value).sort()).toEqual(['days', 'lastCallAt', 'pace', 'readAt', 'today']);
    expect(JSON.stringify(value)).not.toMatch(/xai|providers|usdPerEur|timeZone/u);
    expect(CreatorIdSchema.safeParse(value.readAt).success).toBe(false);
  });
});
