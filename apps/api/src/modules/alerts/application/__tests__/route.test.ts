import { CreatorIdSchema, type CreatorAlertLine, type NotificationRequest } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorAlertLines } from '../../domain/creator-alerts';
import { routeAlerts, type RoutedEventRow, type RouterReads } from '../route';

const NORA = CreatorIdSchema.parse('01900000-0000-7000-8000-000000000010');
const CONVERSATION = '01900000-0000-7000-8000-000000000020';
const NOW = new Date('2026-11-19T15:00:00Z');

function harness(options: {
  readonly events: readonly RoutedEventRow[];
  readonly lines?: () => Promise<readonly CreatorAlertLine[]>;
  readonly onShift?: readonly string[];
}) {
  const asked: NotificationRequest[] = [];
  const reads: RouterReads = {
    events: () => Promise.resolve(options.events),
    lines: options.lines ?? (() => Promise.resolve(creatorAlertLines([]))),
    creators: () => Promise.resolve([{ id: NORA, name: 'Nora' }]),
    owners: () => Promise.resolve([{ userId: 'owner', timeZone: 'Europe/Paris' }]),
    managers: () => Promise.resolve([{ userId: 'manager', timeZone: 'Europe/Paris' }]),
    members: (ids) =>
      Promise.resolve(ids.map((id) => ({ userId: `user-of-${id}`, timeZone: 'Africa/Porto-Novo' }))),
  };
  const unread: unknown[] = [];
  const run = () =>
    routeAlerts(
      {
        reads,
        onShift: () => Promise.resolve((options.onShift ?? []).map((memberId) => ({ memberId }))),
        notify: (request) => {
          asked.push(request);
          return Promise.resolve('rang');
        },
        onLinesUnread: (_creatorId, error) => unread.push(error),
      },
      NOW,
    );
  return { asked, unread, run };
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
      ['owner', 'creator_alert', 'event-1', 'Europe/Paris', undefined],
      ['manager', 'creator_alert', 'event-1', 'Europe/Paris', undefined],
      ['user-of-member-1', 'creator_alert', 'event-1', 'Africa/Porto-Novo', undefined],
    ]);
    expect(h.asked[0]?.message.url).toBe(`/suivi?conversation=${CONVERSATION}`);
  });

  it('delivers a safety relay even when a row says otherwise (forced past the base’s check)', async () => {
    const forced: CreatorAlertLine[] = [
      {
        code: 'safety_handoff',
        family: 'safety',
        locked: true,
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

  it('tells the agency’s budget once to each role, never to a chatter', async () => {
    const budget: RoutedEventRow = {
      id: 'event-4',
      creatorId: null,
      type: 'budget_threshold_crossed',
      payload: {},
    };
    const h = harness({ events: [budget], onShift: ['member-1'] });
    await h.run();
    expect(h.asked.map((r) => [r.userId, r.message.title])).toEqual([
      ['owner', 'Budget IA'],
      ['manager', 'Budget IA'],
    ]);
  });
});
