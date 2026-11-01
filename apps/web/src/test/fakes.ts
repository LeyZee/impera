import { AgentModeSchema, DashboardSchema, type Dashboard as ApiDashboard } from '@nirvana/contracts';
import { vi } from 'vitest';
import { z } from 'zod';

/* Fakes shared by the screen tests: invented creators and fans, never real data (testing.md). */

export const CREATOR = {
  id: '0192f3a0-0000-7000-8000-0000000000c1',
  displayName: 'Léa',
  timezone: 'Europe/Paris',
};

const FAN = '0192f3a0-0000-7000-8000-0000000000f1';
const CONVERSATION = '0192f3a0-0000-7000-8000-000000000001';

/** A server Dashboard, parsed with the contract: copilot, Automatique closed, one urgent todo, one best fan. */
export function apiDashboard(patch: Partial<ApiDashboard> = {}): ApiDashboard {
  return DashboardSchema.parse({
    creator: { id: CREATOR.id, name: 'Léa', timezone: 'Europe/Paris', now: '2026-10-19T12:00:00Z' },
    period: 'day',
    mode: 'copilot',
    globalStop: false,
    automatic: {
      open: false,
      missing: [
        { kind: 'live_rate', value: 64.5, target: 80 },
        { kind: 'decided_drafts', value: 37, target: 100 },
      ],
    },
    liveRate: { rate: 64.5, target: 80, decided: 37, threeWeeksAgo: null },
    reveal: { connected: true, lastReadAt: '2026-10-19T11:59:46Z', late: false, conversations: 12 },
    voice: { ok: true, keyMissing: false, medianWriteMs: 3100, outagesLast7d: 0 },
    jobs: { dead: 0 },
    replies: { medianReplyMinutes: 1.7, fansWaitingOver10Min: 0, conversationsOpen: 9 },
    guards: {
      today: {
        minor: 1,
        non_consent: 0,
        distress: 0,
        meeting: 0,
        manipulation: 0,
        guard: 0,
        budget: 0,
        keyword: 0,
        llm_unavailable: 0,
        other: 0,
        custom_alert: 0,
        identity_doubt: 0,
        persona_inactive: 0,
      },
      telegramAlertsTonight: null,
    },
    telegramCoverage: null,
    budget: { spentToday: 7.4, cap: 20, alertAt: 16, costPerEuroSold: null },
    todos: [
      {
        id: 'todo-1',
        tone: 'bad',
        kind: 'minor',
        title: 'Kévin',
        why: 'L’agent ne lui écrit plus tant que tu n’as pas regardé la conversation.',
        at: '2026-10-19T11:41:00Z',
        waitingMinutes: 19,
        conversationId: CONVERSATION,
        fanId: FAN,
      },
    ],
    fans: [
      {
        id: '0192f3a0-0000-7000-8000-0000000000f2',
        name: 'Théo',
        conversationId: CONVERSATION,
        firstSeenAt: '2026-09-14T12:00:00Z',
        spent: 120,
        byAgent: 80,
        notes: ['Infirmier de nuit'],
      },
    ],
    usdSales: { seen: false, rate: null },
    ...patch,
  });
}

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const MODE_BODY = z.object({ creatorId: z.string(), mode: AgentModeSchema });

/**
 * Replaces `fetch` with a fake server: `/v1/creators` lists `creators` (`CREATOR` by default), `/v1/dashboard`
 * answers `dashboard` (a reply, or a function of the request for a server that changes its mind), `PUT
 * /v1/agent/mode` answers `writeMode` (500 if absent). Returns the mock, to count the calls.
 */
export function serveDashboard(
  dashboard: Reply | ((url: URL) => Reply),
  creators: readonly (typeof CREATOR)[] = [CREATOR],
  writeMode: (body: z.infer<typeof MODE_BODY>) => Reply = () => ({ status: 500 }),
): ReturnType<typeof vi.fn> {
  const fake = vi.fn((input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const reply: Reply =
      url.pathname === '/v1/creators'
        ? { status: 200, body: { creators } }
        : url.pathname === '/v1/agent/mode'
          ? writeMode(MODE_BODY.parse(JSON.parse(typeof init?.body === 'string' ? init.body : 'null')))
          : typeof dashboard === 'function'
            ? dashboard(url)
            : dashboard;
    return Promise.resolve(new Response(JSON.stringify(reply.body ?? null), { status: reply.status }));
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}
