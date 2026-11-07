import {
  CreatorIdSchema,
  CreatorOverviewSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type SalesTotalsRow,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorOverview, fortnightDays } from '../creators-overview';
import type { CreatorOverviewFacts } from '../dashboard-ports';

// Everything below is invented (ADR 0010).
const CREATOR = newId(CreatorIdSchema);
const ACCOUNT = newId(PlatformAccountIdSchema);
const THEO = newId(TeamMemberIdSchema);
const NORA = newId(TeamMemberIdSchema);
const NOW = new Date('2026-11-20T21:30:00Z');

const facts = (patch: Partial<CreatorOverviewFacts> = {}): CreatorOverviewFacts => ({
  timezone: 'Europe/Paris',
  scope: 'owner',
  switches: { global: false, creator: false },
  autoConversations: 0,
  requests: [],
  names: new Map([
    [THEO, 'Théo'],
    [NORA, 'Nora'],
  ]),
  ...patch,
});

const row = (patch: Partial<SalesTotalsRow> = {}): SalesTotalsRow => ({
  day: '2026-11-18',
  platform: 'reveal',
  platformAccountId: ACCOUNT,
  currency: 'EUR',
  saleType: 'ppv',
  seller: { kind: 'agent' },
  sales: 2,
  refunds: 0,
  grossInclVatMinor: 2400,
  grossExclVatMinor: 2000,
  netMinor: 1600,
  agencyMinor: 600,
  creatorMinor: 1000,
  ...patch,
});

const sales = (rows: SalesTotalsRow[]) => ({
  platforms: ['reveal'] as const,
  totals: { from: '2026-11-16', to: '2026-11-20', rows, refundsWithoutSale: 0 },
  names: null,
});

describe('the cards of the list of Créatrices', () => {
  it('cuts her fortnight as pay does, in her zone', () => {
    expect(fortnightDays(NOW, 'Europe/Paris')).toEqual({ from: '2026-11-16', to: '2026-11-20' });
    expect(fortnightDays(new Date('2026-11-15T23:30:00Z'), 'Europe/Paris')).toEqual({
      from: '2026-11-16',
      to: '2026-11-16',
    });
    expect(fortnightDays(new Date('2026-11-15T23:30:00Z'), 'America/Montreal')).toEqual({
      from: '2026-11-01',
      to: '2026-11-15',
    });
  });

  it('gives the owner her mode, the register’s totals, who is on shift and what she still owes', () => {
    const card = creatorOverview({
      creatorId: CREATOR,
      facts: facts({
        autoConversations: 3,
        requests: [
          { category: 'feed_video', dueOn: '2026-11-22' },
          { category: 'feed_shoot', dueOn: '2026-11-19' },
        ],
      }),
      now: NOW,
      sales: sales([row(), row({ currency: 'EUR', refunds: 1, sales: 0, grossInclVatMinor: -600 })]),
      rate: null,
      onShift: [
        { memberId: NORA, endsAt: new Date('2026-11-21T02:00:00Z') },
        { memberId: THEO, endsAt: new Date('2026-11-20T23:00:00Z') },
        { memberId: THEO, endsAt: new Date('2026-11-21T01:00:00Z') },
        // A member the team does not name: never shown by his id.
        { memberId: newId(TeamMemberIdSchema), endsAt: new Date('2026-11-21T01:00:00Z') },
      ],
    });
    expect(CreatorOverviewSchema.parse(card)).toEqual(card);
    expect(card.mode).toBe('auto');
    expect(card.sales).toEqual({
      from: '2026-11-16',
      to: '2026-11-20',
      sales: 2,
      refunds: 1,
      revenueMinor: 1800,
      usdLeftOut: false,
    });
    expect(card.onShift).toEqual([
      { memberId: THEO, name: 'Théo', endsAt: '2026-11-21T01:00:00.000Z' },
      { memberId: NORA, name: 'Nora', endsAt: '2026-11-21T02:00:00.000Z' },
    ]);
    expect(card.requests).toEqual({
      open: 2,
      next: { category: 'feed_shoot', dueOn: '2026-11-19', late: true },
    });
  });

  it('says a dollar sale left out while no rate is known, and nothing before the register is linked', () => {
    const usd = creatorOverview({
      creatorId: CREATOR,
      facts: facts(),
      now: NOW,
      sales: sales([row({ currency: 'USD' })]),
      rate: null,
      onShift: [],
    });
    expect(usd.sales).toMatchObject({ sales: 0, revenueMinor: 0, usdLeftOut: true });
    const unlinked = creatorOverview({
      creatorId: CREATOR,
      facts: facts(),
      now: NOW,
      sales: undefined,
      rate: null,
      onShift: [],
    });
    expect(unlinked).toMatchObject({ sales: null, onShift: [], requests: { open: 0, next: null } });
  });

  it('gives a reader whose scope is his own her mode alone (ADR 0043 § 7)', () => {
    const card = creatorOverview({
      creatorId: CREATOR,
      facts: facts({ scope: 'self', switches: { global: false, creator: true } }),
      now: NOW,
      sales: sales([row()]),
      rate: null,
      onShift: [{ memberId: THEO, endsAt: new Date('2026-11-21T01:00:00Z') }],
    });
    expect(card).toEqual({ creatorId: CREATOR, mode: 'stop', sales: null, onShift: null, requests: null });
  });
});
