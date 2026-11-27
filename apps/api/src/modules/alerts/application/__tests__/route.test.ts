import { CreatorIdSchema, type CreatorAlertLine, type NotificationRequest } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorAlertLines } from '../../domain/creator-alerts';
import { routeAlerts, type RoutedEventRow, type RouterReads } from '../route';

const NORA = CreatorIdSchema.parse('01900000-0000-7000-8000-000000000010');
const IRIS = '01900000-0000-7000-8000-000000000012';
const CONVERSATION = '01900000-0000-7000-8000-000000000020';
const NOW = new Date('2026-11-19T15:00:00Z');

function harness(options: {
  readonly events: readonly RoutedEventRow[];
  readonly lines?: () => Promise<readonly CreatorAlertLine[]>;
  readonly onShift?: readonly string[];
  readonly failing?: readonly ('events' | 'managers' | 'on_shift' | 'members' | 'creator_accounts')[];
}) {
  const fails = (step: 'events' | 'managers' | 'on_shift' | 'members' | 'creator_accounts') =>
    options.failing?.includes(step) === true;
  const down = () => Promise.reject(new Error('down'));
  const asked: NotificationRequest[] = [];
  const reads: RouterReads = {
    safetyEvents: () =>
      Promise.resolve(
        options.events.filter(
          (event) => event.type === 'handoff_requested' && JSON.stringify(event.payload).includes('"minor"'),
        ),
      ),
    events: () => (fails('events') ? down() : Promise.resolve(options.events)),
    agencyEvents: () => Promise.resolve([]),
    waitingSafety: () => Promise.resolve([]),
    lines: options.lines ?? (() => Promise.resolve(creatorAlertLines([]))),
    creators: () => Promise.resolve([{ id: NORA, name: 'Nora' }]),
    owners: () => Promise.resolve([{ userId: 'owner', timeZone: 'Europe/Paris' }]),
    managers: () =>
      fails('managers')
        ? down()
        : Promise.resolve([
            { userId: 'manager', timeZone: 'Europe/Paris', creatorIds: [NORA] },
            { userId: 'manager-of-iris', timeZone: 'Europe/Paris', creatorIds: [IRIS] },
          ]),
    members: (ids) =>
      fails('members')
        ? down()
        : Promise.resolve(ids.map((id) => ({ userId: `user-of-${id}`, timeZone: 'Africa/Porto-Novo' }))),
    creatorAccounts: () =>
      fails('creator_accounts')
        ? down()
        : Promise.resolve([{ userId: 'nora-herself', timeZone: 'America/Montreal' }]),
  };
  const unread: unknown[] = [];
  const failures: string[] = [];
  const run = () =>
    routeAlerts(
      {
        reads,
        onShift: () =>
          fails('on_shift')
            ? down()
            : Promise.resolve((options.onShift ?? []).map((memberId) => ({ memberId }))),
        notify: (request) => {
          asked.push(request);
          return Promise.resolve('rang');
        },
        onLinesUnread: (_creatorId, error) => unread.push(error),
        onFailure: (step) => failures.push(step),
      },
      NOW,
    );
  return { asked, unread, failures, run };
}

const safety: RoutedEventRow = {
  id: 'event-1',
  creatorId: NORA,
  type: 'handoff_requested',
  payload: { conversationId: CONVERSATION, cause: 'minor' },
};

describe('alerts.route (ADR 0150 lot 2)', () => {
  it('tells each role of her tab once, keyed by the event, in each account’s own zone', async () => {
    const h = harness({ events: [safety], onShift: ['member-1'] });
    expect(await h.run()).toBe(3);
    expect(h.asked.map((r) => [r.userId, r.reason, r.objectKey, r.timeZone, r.message.silent])).toEqual([
      ['owner', 'safety_alert', 'event-1', 'Europe/Paris', undefined],
      ['manager', 'safety_alert', 'event-1', 'Europe/Paris', undefined],
      ['user-of-member-1', 'safety_alert', 'event-1', 'Africa/Porto-Novo', undefined],
    ]);
    expect(h.asked[0]?.message.url).toBe(`/suivi?conversation=${CONVERSATION}`);
  });

  it('rings any other alert under the ordinary reason, its quiet hours and its cap', async () => {
    const sale: RoutedEventRow = { id: 'event-5', creatorId: NORA, type: 'sale_detected', payload: {} };
    const h = harness({ events: [sale] });
    await h.run();
    expect(new Set(h.asked.map((r) => r.reason))).toEqual(new Set(['creator_alert']));
  });

  it('routes the safety relays read apart even when the other events cannot be read (relecture Sécurité)', async () => {
    const h = harness({ events: [safety], failing: ['events'] });
    await h.run();
    expect(h.asked.map((r) => r.userId)).toEqual(['owner', 'manager']);
    expect(h.failures).toEqual(['events']);
  });

  it('tells the owner and the manager when the shift, its members or the managers cannot be read', async () => {
    const onShift = harness({ events: [safety], onShift: ['member-1'], failing: ['on_shift'] });
    await onShift.run();
    expect(onShift.asked.map((r) => r.userId)).toEqual(['owner', 'manager']);
    expect(onShift.failures).toEqual(['on_shift']);

    const members = harness({ events: [safety], onShift: ['member-1'], failing: ['members'] });
    await members.run();
    expect(members.asked.map((r) => r.userId)).toEqual(['owner', 'manager']);

    const managers = harness({ events: [safety], onShift: ['member-1'], failing: ['managers'] });
    await managers.run();
    expect(managers.asked.map((r) => r.userId)).toEqual(['owner', 'user-of-member-1']);
  });

  it('delivers a safety relay even when a row says otherwise (forced past the base’s check)', async () => {
    const forced: CreatorAlertLine[] = [
      {
        code: 'safety_handoff',
        family: 'safety',
        locked: true,
        chattersClosed: false,
        routes: { owner: 'off', manager: 'off', chatter_on_shift: 'off' },
        isDefault: false,
      },
    ];
    // A reader that would hand the raw row back, without `creatorAlertLines`: the router still reads the lock.
    const h = harness({ events: [safety], lines: () => Promise.resolve(forced), onShift: ['member-1'] });
    await h.run();
    expect(h.asked.map((r) => r.userId)).toEqual(['owner', 'manager', 'user-of-member-1']);
  });

  it('delivers a safety relay when her choices cannot be read: the defaults, never « nobody »', async () => {
    const h = harness({
      events: [safety],
      lines: () => Promise.reject(new Error('down')),
      onShift: ['member-1'],
    });
    await h.run();
    expect(h.asked).toHaveLength(3);
    expect(h.unread).toHaveLength(1);
  });

  it('comes silent in « sourdine », reaches nobody in « rien »', async () => {
    const lines = creatorAlertLines([
      { alertCode: 'sale', role: 'owner', mode: 'deliver' },
      { alertCode: 'sale', role: 'manager', mode: 'off' },
      { alertCode: 'sale', role: 'chatter_on_shift', mode: 'muted' },
    ]);
    const sale: RoutedEventRow = { id: 'event-2', creatorId: NORA, type: 'sale_detected', payload: {} };
    const h = harness({ events: [sale], lines: () => Promise.resolve(lines), onShift: ['member-1'] });
    await h.run();
    expect(h.asked.map((r) => [r.userId, r.message.silent === true])).toEqual([
      ['owner', false],
      ['user-of-member-1', true],
    ]);
  });

  it('tells nobody of an archived creator, nor of what is not an alert', async () => {
    const h = harness({
      events: [
        { ...safety, creatorId: CreatorIdSchema.parse('01900000-0000-7000-8000-000000000011') },
        { id: 'event-3', creatorId: NORA, type: 'message_received', payload: {} },
      ],
    });
    expect(await h.run()).toBe(0);
  });

  it('tells the agency’s budget once to each manager, never to a chatter; the owners by the agency’s alerts', async () => {
    const budget: RoutedEventRow = {
      id: 'event-4',
      creatorId: null,
      type: 'budget_threshold_crossed',
      payload: {},
    };
    const h = harness({ events: [budget], onShift: ['member-1'] });
    await h.run();
    expect(h.asked.map((r) => [r.userId, r.message.title])).toEqual([
      ['manager', 'Budget IA'],
      ['manager-of-iris', 'Budget IA'],
    ]);
  });

  it('tells a creator’s alert to her managers only, never to the manager of another (relecture Bilan)', async () => {
    const h = harness({ events: [safety] });
    await h.run();
    expect(h.asked.map((r) => r.userId)).toEqual(['owner', 'manager']);
  });

  const herWord = {
    alert: { kind: 'system', code: 'keyword' },
    matchedBy: 'keyword',
    keyword: 'Mot inventé',
  };

  it('rings her persona’s words at once, even at night, and tells her too, without the fan nor the word', async () => {
    const paused: RoutedEventRow = {
      id: 'event-5',
      creatorId: NORA,
      type: 'handoff_requested',
      payload: { conversationId: CONVERSATION, cause: 'keyword', trigger: herWord },
    };
    const h = harness({ events: [paused], onShift: ['member-1'] });
    await h.run();
    expect(h.asked.map((r) => [r.userId, r.reason, r.objectKey])).toEqual([
      ['owner', 'safety_alert', 'event-5'],
      ['manager', 'safety_alert', 'event-5'],
      ['user-of-member-1', 'safety_alert', 'event-5'],
      ['nora-herself', 'safety_alert', 'event-5'],
    ]);
    const hers = h.asked.find((r) => r.userId === 'nora-herself');
    expect(hers?.timeZone).toBe('America/Montreal');
    expect(hers?.message.url).toBe('/aujourdhui');
    expect(JSON.stringify(hers?.message)).not.toContain('Mot inventé');
    expect(JSON.stringify(hers?.message)).not.toContain(CONVERSATION);
  });

  it('tells her of a word heard while the agent did not answer him too (alert_triggered)', async () => {
    const heard: RoutedEventRow = {
      id: 'event-6',
      creatorId: NORA,
      type: 'alert_triggered',
      payload: { conversationId: CONVERSATION, trigger: herWord, notify: true },
    };
    const h = harness({ events: [heard] });
    await h.run();
    expect(h.asked.map((r) => [r.userId, r.reason])).toEqual([
      ['owner', 'safety_alert'],
      ['manager', 'safety_alert'],
      ['nora-herself', 'safety_alert'],
    ]);
  });

  it('never tells her of the agency’s own alerts, and keeps them in the quiet hours', async () => {
    const custom: RoutedEventRow = {
      id: 'event-7',
      creatorId: NORA,
      type: 'alert_triggered',
      payload: {
        conversationId: CONVERSATION,
        trigger: {
          alert: { kind: 'custom', id: '01900000-0000-7000-8000-000000000030' },
          matchedBy: 'keyword',
          keyword: 'autre',
        },
        notify: true,
      },
    };
    const h = harness({ events: [custom] });
    await h.run();
    expect(h.asked.map((r) => [r.userId, r.reason])).toEqual([
      ['owner', 'creator_alert'],
      ['manager', 'creator_alert'],
    ]);
  });

  it('tells the team all the same when her accounts cannot be read', async () => {
    const heard: RoutedEventRow = {
      id: 'event-8',
      creatorId: NORA,
      type: 'alert_triggered',
      payload: { conversationId: CONVERSATION, trigger: herWord, notify: true },
    };
    const h = harness({ events: [heard], failing: ['creator_accounts'] });
    await h.run();
    expect(h.asked.map((r) => r.userId)).toEqual(['owner', 'manager']);
    expect(h.failures).toEqual(['creator_accounts']);
  });
});
