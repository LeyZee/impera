import { describe, expect, it } from 'vitest';

import { DashboardQuerySchema, DashboardSchema } from './dashboard';
import { HANDOFF_CAUSES } from './events';

const CREATOR = '0b9d4b7e-2f7a-4c1e-9a55-3d1f0c2b8e41';
const FAN = '5d2e8c1a-7b3f-4a9e-8c6d-1e2f3a4b5c6d';
const CONVERSATION = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

const dashboard = {
  creator: { id: CREATOR, name: 'Lina', timezone: 'Europe/Paris', now: '2026-10-17T21:30:00.000Z' },
  period: 'day',
  mode: 'copilot',
  globalStop: false,
  automatic: {
    open: false,
    missing: [{ kind: 'decided_drafts', value: 2, target: 100 }, { kind: 'blind_test' }],
  },
  liveRate: { rate: 84, target: 80, decided: 37, threeWeeksAgo: null },
  reveal: { connected: true, lastReadAt: '2026-10-17T21:29:30.000Z', late: false, conversations: 42 },
  voice: { ok: true, keyMissing: false, medianWriteMs: 1400, outagesLast7d: 0 },
  jobs: { dead: 0 },
  replies: { medianReplyMinutes: 3.5, fansWaitingOver10Min: 1, conversationsOpen: 12 },
  guards: {
    today: { ...Object.fromEntries(HANDOFF_CAUSES.map((cause) => [cause, 0])), minor: 1, meeting: 2 },
    telegramAlertsTonight: 2,
  },
  telegramCoverage: { urgentReachable: true },
  budget: { spentToday: 3.2, cap: 20, alertAt: 16, costPerEuroSold: null },
  todos: [
    {
      id: `handoff-${CONVERSATION}`,
      tone: 'bad',
      kind: 'minor',
      title: 'Julien',
      why: 'Il a peut-être moins de 18 ans. L’agent ne lui écrit plus.',
      at: '2026-10-17T21:02:00.000Z',
      waitingMinutes: 28,
      conversationId: CONVERSATION,
      fanId: FAN,
    },
  ],
  fans: [
    {
      id: FAN,
      name: 'Julien',
      conversationId: CONVERSATION,
      firstSeenAt: '2026-10-01T18:00:00.000Z',
      spent: 45,
      byAgent: 30,
      notes: ['Habite à Nantes'],
      alert: 'minor',
    },
  ],
  usdSales: { seen: true, rate: { day: '2026-10-27' } },
};

describe('dashboard contract', () => {
  it('reads a filled dashboard', () => {
    expect(DashboardSchema.parse(dashboard).todos[0]?.kind).toBe('minor');
  });

  it('refuses a rate outside 0 to 100, and a count of guards without every cause', () => {
    expect(
      DashboardSchema.safeParse({ ...dashboard, liveRate: { ...dashboard.liveRate, rate: 840 } }).success,
    ).toBe(false);
    expect(
      DashboardSchema.safeParse({
        ...dashboard,
        guards: { today: { minor: 1 }, telegramAlertsTonight: null },
      }).success,
    ).toBe(false);
  });

  it('gives the ECB day of the dollar rate as a calendar day, or null when no rate is known', () => {
    expect(DashboardSchema.parse(dashboard).usdSales.rate).toEqual({ day: '2026-10-27' });
    expect(
      DashboardSchema.parse({ ...dashboard, usdSales: { seen: true, rate: null } }).usdSales.rate,
    ).toBeNull();
    expect(
      DashboardSchema.safeParse({ ...dashboard, usdSales: { seen: true, rate: { day: '27/10/2026' } } })
        .success,
    ).toBe(false);
  });

  it('defaults the period to the day', () => {
    expect(DashboardQuerySchema.parse({ creatorId: CREATOR }).period).toBe('day');
    expect(DashboardQuerySchema.safeParse({ creatorId: CREATOR, period: 'year' }).success).toBe(false);
  });
});
