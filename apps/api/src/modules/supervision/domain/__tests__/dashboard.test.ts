import {
  CreatorIdSchema,
  DEFAULT_AGENT_HOURS,
  DashboardSchema,
  type AutomaticGate,
  type LiveRateReading,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  assembleDashboard,
  creatorQueue,
  queueAcross,
  revealLate,
  todos,
  unansweredSince,
  type VoiceHealth,
} from '../dashboard';
import type { DashboardFacts, TelegramReading, WaitingConversation } from '../dashboard-ports';

const NOW = new Date('2026-10-17T21:30:00.000Z');
const CONVERSATION = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const FAN = '5d2e8c1a-7b3f-4a9e-8c6d-1e2f3a4b5c6d';
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const FACTS: DashboardFacts = {
  creator: { name: 'Lina', timezone: 'Europe/Paris' },
  switches: { global: false, creator: false },
  autoConversations: 0,
  decidedThreeWeeksAgo: [],
  reveal: {
    connected: true,
    lastReadAt: minutesAgo(1),
    sessionSince: minutesAgo(90),
    pollEverySeconds: 80,
    conversations: 4,
  },
  voice: { medianWriteMs: 1412.5, outageHoursLast7d: 0 },
  replies: { medianReplyMinutes: 3.25, fansWaitingOver10Min: 1, conversationsOpen: 2 },
  handoffsToday: [{ cause: 'meeting', count: 2 }],
  waiting: [],
  fans: [
    {
      id: FAN,
      name: 'Julien',
      conversationId: CONVERSATION,
      firstSeenAt: minutesAgo(600),
      spentMinor: 4_500,
      byAgentMinor: 3_000,
      notes: ['Habite à Nantes'],
      alert: undefined,
    },
  ],
  usdSales: { seen: false, rateDay: null },
};

const assemble = (
  facts: Partial<DashboardFacts> = {},
  telegram: TelegramReading | 'off' = { alertsTonight: 3, urgentReachable: false },
  automatic: AutomaticGate = { open: false, missing: [{ kind: 'blind_test' }] },
  reading: LiveRateReading = { rate: 0.8, decided: 10 },
  health: { voice?: VoiceHealth; deadJobs?: number | null } = {},
) =>
  assembleDashboard({
    creatorId: CreatorIdSchema.parse('0b9d4b7e-2f7a-4c1e-9a55-3d1f0c2b8e41'),
    period: 'day',
    facts: { ...FACTS, ...facts },
    window: {
      now: NOW,
      dayStart: minutesAgo(23 * 60),
      periodStart: minutesAgo(23 * 60),
      voice: { voicePrompt: '1.5.0', voiceModel: 'grok-4.7' },
    },
    budget: { spentEur: 3.204, capEur: 20, alertAtEur: 16 },
    voice: health.voice ?? { ok: true, keyMissing: false },
    deadJobs: health.deadJobs === undefined ? 0 : health.deadJobs,
    telegram: telegram === 'off' ? undefined : telegram,
    automatic: { gate: automatic, reading },
  });

describe('dashboard', () => {
  it('fits the contract, in euros and %', () => {
    const dashboard = DashboardSchema.parse(assemble());
    expect(dashboard.liveRate).toEqual({ rate: 80, target: 80, decided: 10, threeWeeksAgo: null });
    expect(dashboard.fans[0]).toMatchObject({ spent: 45, byAgent: 30 });
    expect(dashboard.budget.spentToday).toBe(3.2);
    expect(dashboard.guards.today.meeting).toBe(2);
    expect(dashboard.guards.today.minor).toBe(0);
    expect(dashboard.guards.telegramAlertsTonight).toBe(3);
    expect(dashboard.telegramCoverage).toEqual({ urgentReachable: false });
  });

  it('says how the dollar sales were counted: at which ECB day, or not at all (choix de Charles, 28/10)', () => {
    expect(assemble().usdSales).toEqual({ seen: false, rate: null });
    expect(assemble({ usdSales: { seen: true, rateDay: '2026-10-16' } }).usdSales).toEqual({
      seen: true,
      rate: { day: '2026-10-16' },
    });
    expect(DashboardSchema.parse(assemble({ usdSales: { seen: true, rateDay: null } })).usdSales).toEqual({
      seen: true,
      rate: null,
    });
  });

  it('names a fan without a pseudonym rather than failing the whole page (recette 28/10)', () => {
    const dashboard = DashboardSchema.parse(
      assemble({
        fans: [{ ...FACTS.fans[0]!, name: '  ' }],
        waiting: [
          {
            conversationId: CONVERSATION,
            fanId: FAN,
            fanName: '',
            kind: 'awaiting_approval',
            since: minutesAgo(5),
          },
        ],
      }),
    );
    expect(dashboard.fans[0]?.name).toBe('Fan sans nom');
    expect(dashboard.todos[0]?.title).toBe('Fan sans nom');
  });

  it('passes a missing key and the stuck jobs through as read, unknown included', () => {
    const missing = DashboardSchema.parse(
      assemble({}, 'off', undefined, undefined, { voice: { ok: false, keyMissing: true }, deadJobs: 2 }),
    );
    expect(missing.voice).toMatchObject({ ok: false, keyMissing: true });
    expect(missing.jobs).toEqual({ dead: 2 });
    const unknown = DashboardSchema.parse(assemble({}, 'off', undefined, undefined, { deadJobs: null }));
    expect(unknown.jobs).toEqual({ dead: null });
  });

  it('says Telegram is off rather than that no alert gets through', () => {
    const dashboard = DashboardSchema.parse(assemble({}, 'off'));
    expect(dashboard.guards.telegramAlertsTonight).toBeNull();
    expect(dashboard.telegramCoverage).toBeNull();
  });

  it('shows the lock as conversations reads it, never recomputed from the live rate', () => {
    const full = { rate: 1, decided: 150 };
    expect(assemble({}, 'off', undefined, full).automatic).toEqual({
      open: false,
      missing: [{ kind: 'blind_test' }],
    });
    expect(assemble({}, 'off', { open: true, missing: [] }, full).automatic).toEqual({
      open: true,
      missing: [],
    });
  });

  it('shows the live rate the lock was decided on, and the trend from three weeks ago', () => {
    const lock: AutomaticGate = { open: false, missing: [{ kind: 'live_rate', value: 79.5, target: 80 }] };
    const dashboard = assemble(
      { decidedThreeWeeksAgo: Array.from({ length: 4 }, (_, i) => ({ asIs: i < 3 })) },
      'off',
      lock,
      { rate: 0.795, decided: 200 },
    );
    expect(dashboard.liveRate).toEqual({ rate: 79.5, target: 80, decided: 200, threeWeeksAgo: 75 });
    expect(dashboard.automatic.missing).toEqual([{ kind: 'live_rate', value: 79.5, target: 80 }]);
  });

  it('says Arrêt over everything, and Automatique when a conversation runs on its own', () => {
    const hers = assemble({ switches: { global: false, creator: true }, autoConversations: 3 });
    expect(hers).toMatchObject({ mode: 'stop', globalStop: false });
    const everyone = assemble({ switches: { global: true, creator: false } });
    expect(everyone).toMatchObject({ mode: 'stop', globalStop: true });
    expect(assemble({ autoConversations: 1 }).mode).toBe('auto');
    expect(assemble().mode).toBe('copilot');
  });
});

describe('revealLate (recette 28/10, G8)', () => {
  it('says late once three polls, each at its longest, have gone by without a read', () => {
    const read = (lastReadAt: Date) => ({ lastReadAt, sessionSince: minutesAgo(90) });
    // 80 s between polls at most, plus a minute for the dispatcher: 7 minutes.
    expect(revealLate(read(minutesAgo(7)), NOW, 80)).toBe(false);
    expect(revealLate(read(minutesAgo(8)), NOW, 80)).toBe(true);
    // An account polled every hour is not late after ten minutes.
    expect(revealLate(read(minutesAgo(10)), NOW, 3_600)).toBe(false);
  });

  it('counts from the session when nothing was ever read: the first day is late too', () => {
    // The session set an hour ago, never read: the worker is stopped or the first read failed.
    expect(revealLate({ lastReadAt: null, sessionSince: minutesAgo(60) }, NOW, 80)).toBe(true);
    // Set five minutes ago: the first read may still come.
    expect(revealLate({ lastReadAt: null, sessionSince: minutesAgo(5) }, NOW, 80)).toBe(false);
    // A read after the session counts, not the session.
    expect(revealLate({ lastReadAt: minutesAgo(1), sessionSince: minutesAgo(60) }, NOW, 80)).toBe(false);
  });

  it('waits for the first poll after a session captured again, whatever the old read says', () => {
    // Read last three hours ago, session set again a minute ago: not late yet.
    expect(revealLate({ lastReadAt: minutesAgo(180), sessionSince: minutesAgo(1) }, NOW, 80)).toBe(false);
    // Still no read an hour after the new session: late.
    expect(revealLate({ lastReadAt: minutesAgo(240), sessionSince: minutesAgo(60) }, NOW, 80)).toBe(true);
  });

  it('is never late with no session date and no read', () => {
    expect(revealLate({ lastReadAt: null, sessionSince: null }, NOW, 80)).toBe(false);
  });

  it('reaches the Dashboard only while the session holds: disconnected says more', () => {
    const stale = {
      lastReadAt: minutesAgo(60),
      sessionSince: minutesAgo(90),
      pollEverySeconds: 80,
      conversations: 4,
    };
    expect(assemble({ reveal: { connected: true, ...stale } }).reveal).toMatchObject({
      connected: true,
      late: true,
    });
    expect(assemble({ reveal: { connected: false, ...stale } }).reveal.late).toBe(false);
    expect(assemble().reveal.late).toBe(false);
  });
});

describe('à traiter', () => {
  it('puts a possible minor first, then the longest waiting', () => {
    const list = todos(
      [
        {
          conversationId: CONVERSATION,
          fanId: FAN,
          fanName: 'A',
          kind: 'awaiting_approval',
          since: minutesAgo(40),
        },
        { conversationId: CONVERSATION, fanId: FAN, fanName: 'B', kind: 'meeting', since: minutesAgo(15) },
        { conversationId: CONVERSATION, fanId: FAN, fanName: 'C', kind: 'minor', since: minutesAgo(5) },
      ],
      NOW,
    );
    expect(list.map((t) => [t.title, t.tone, t.waitingMinutes])).toEqual([
      ['C', 'bad', 5],
      ['A', 'warn', 40],
      ['B', 'warn', 15],
    ]);
  });

  it('says that a send failed for good and that a human must send it again', () => {
    const [todo] = todos(
      [{ conversationId: CONVERSATION, fanId: FAN, fanName: 'D', kind: 'send_failed', since: minutesAgo(3) }],
      NOW,
    );
    expect(todo).toMatchObject({ kind: 'send_failed', tone: 'warn', waitingMinutes: 3 });
    expect(todo?.why).toContain('un humain doit le renvoyer');
  });

  it('says that his message has waited 30 minutes with nothing under way (P3-11)', () => {
    const [todo] = todos(
      [{ conversationId: CONVERSATION, fanId: FAN, fanName: 'E', kind: 'unanswered', since: minutesAgo(42) }],
      NOW,
    );
    expect(todo).toMatchObject({ kind: 'unanswered', tone: 'warn', waitingMinutes: 42 });
    expect(todo?.why).toContain('plus de 30 minutes');
  });
});

describe('à traiter sur Arrêt (choix de Charles, 28/10)', () => {
  const line = (
    fanName: string,
    kind: WaitingConversation['kind'],
    minutes: number,
  ): WaitingConversation => ({
    conversationId: CONVERSATION,
    fanId: FAN,
    fanName,
    kind,
    since: minutesAgo(minutes),
  });
  const waiting = [
    line('A', 'awaiting_approval', 40),
    line('B', 'meeting', 30),
    line('C', 'distress', 20),
    line('D', 'send_failed', 15),
    line('E', 'non_consent', 10),
    line('F', 'unanswered', 45),
    line('G', 'minor', 5),
  ];

  it('keeps a possible minor, consent and distress only, the longest waiting first', () => {
    const list = todos(waiting, NOW, { stopped: true });
    expect(list.map((t) => [t.title, t.kind, t.tone])).toEqual([
      ['C', 'distress', 'bad'],
      ['E', 'non_consent', 'bad'],
      ['G', 'minor', 'bad'],
    ]);
  });

  it('keeps every line while the agent runs', () => {
    expect(todos(waiting, NOW, { stopped: false })).toHaveLength(waiting.length);
    expect(todos(waiting, NOW)).toHaveLength(waiting.length);
  });

  it('applies on her switch and on the global one, from the facts', () => {
    const facts = { waiting };
    const kinds = (switches: DashboardFacts['switches']) =>
      assemble({ ...facts, switches }).todos.map((t) => t.kind);
    expect(kinds({ global: false, creator: true })).toEqual(['distress', 'non_consent', 'minor']);
    expect(kinds({ global: true, creator: false })).toEqual(['distress', 'non_consent', 'minor']);
    expect(kinds({ global: false, creator: false })).toHaveLength(waiting.length);
  });
});

describe('unansweredSince (P3-14)', () => {
  const PARIS = 'Europe/Paris';
  // Tuesday 27 October 2026, winter time in Paris (UTC+1); her slot from 9:00 to 18:00 on Tuesdays.
  const her = {
    hours: {
      ...DEFAULT_AGENT_HOURS,
      reply: {
        mode: 'slots' as const,
        slots: [{ day: 2, startMinute: 540, endMinute: 1080, enabled: true }],
      },
    },
    timeZone: PARIS,
  };
  const at = (hhmm: string): Date => new Date(`2026-10-27T${hhmm}:00+01:00`);

  it('counts from his message without a setting', () => {
    const always = { hours: DEFAULT_AGENT_HOURS, timeZone: PARIS };
    expect(unansweredSince(at('03:00'), at('03:30'), always)).toEqual(at('03:00'));
    expect(unansweredSince(at('03:00'), at('03:29'), always)).toBeNull();
  });

  it('is silent out of her slots, and counts again from her opening', () => {
    // He wrote at 3:00: nothing at 4:00, nothing at 9:20, thirty minutes after her 9:00 opening he is back,
    // waiting since his own message, so that the fans of her night keep the order they wrote in.
    expect(unansweredSince(at('03:00'), at('04:00'), her)).toBeNull();
    expect(unansweredSince(at('03:00'), at('09:20'), her)).toBeNull();
    expect(unansweredSince(at('03:00'), at('09:30'), her)).toEqual(at('03:00'));
    expect(unansweredSince(at('05:00'), at('09:30'), her)).toEqual(at('05:00'));
    // Written in her slot: from his message.
    expect(unansweredSince(at('10:00'), at('10:30'), her)).toEqual(at('10:00'));
    // Her slot closed at 18:00: silent again.
    expect(unansweredSince(at('10:00'), at('18:30'), her)).toBeNull();
  });
});

describe('à traiter, every creator followed (SUIVI-09, DASH-03)', () => {
  const LEA = '0192f3a0-0000-7000-8000-00000000c001';
  const INES = '0192f3a0-0000-7000-8000-00000000c002';
  const waiting = (fanName: string, kind: 'awaiting_approval' | 'minor' | 'meeting', minutes: number) => ({
    conversationId: CONVERSATION,
    fanId: FAN,
    fanName,
    kind,
    since: minutesAgo(minutes),
  });

  it('names each line’s creator, the gravest first across them all, then the longest waiting', () => {
    const merged = queueAcross([
      {
        creatorId: CreatorIdSchema.parse(LEA),
        name: 'Léa',
        todos: todos([waiting('Hugo', 'meeting', 20), waiting('Théo', 'awaiting_approval', 50)], NOW),
      },
      {
        creatorId: CreatorIdSchema.parse(INES),
        name: 'Inès',
        todos: todos([waiting('Arthur', 'awaiting_approval', 35), waiting('Kévin', 'minor', 2)], NOW),
      },
    ]);
    expect(merged.items.map((t) => [t.creatorName, t.title])).toEqual([
      ['Inès', 'Kévin'],
      ['Léa', 'Théo'],
      ['Inès', 'Arthur'],
      ['Léa', 'Hugo'],
    ]);
    expect(merged.items[0]).toMatchObject({ creatorId: INES, tone: 'bad' });
  });

  it('counts each creator’s lines and grave ones, in her order, none when nothing waits', () => {
    const merged = queueAcross([
      { creatorId: CreatorIdSchema.parse(LEA), name: 'Léa', todos: [] },
      {
        creatorId: CreatorIdSchema.parse(INES),
        name: 'Inès',
        todos: todos([waiting('Kévin', 'minor', 2), waiting('Arthur', 'awaiting_approval', 35)], NOW),
      },
    ]);
    expect(merged.creators).toEqual([
      { creatorId: LEA, name: 'Léa', todos: 0, grave: 0 },
      { creatorId: INES, name: 'Inès', todos: 2, grave: 1 },
    ]);
  });

  it('keeps the grave lines only of a creator on Arrêt, as her Dashboard does', () => {
    const facts: DashboardFacts = {
      ...FACTS,
      switches: { global: false, creator: true },
      waiting: [waiting('Kévin', 'minor', 2), waiting('Arthur', 'awaiting_approval', 35)],
    };
    const queue = creatorQueue(CreatorIdSchema.parse(INES), facts, NOW);
    expect(queue.todos.map((t) => t.title)).toEqual(['Kévin']);
    expect(queue.name).toBe(FACTS.creator.name);
  });
});
