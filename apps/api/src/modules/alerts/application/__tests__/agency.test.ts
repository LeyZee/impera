import { CreatorIdSchema, type NotificationRequest } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { safetyReminderDue } from '../../domain/agency/message';
import { remindSafety, routeAgencyAlerts } from '../agency';
import type { RoutedEventRow, RouterReads, WaitingSafetyRelay } from '../route';

const NORA = CreatorIdSchema.parse('01900000-0000-7000-8000-000000000010');
const ARCHIVED = CreatorIdSchema.parse('01900000-0000-7000-8000-000000000011');
const CONVERSATION = '01900000-0000-7000-8000-000000000020';
const NOW = new Date('2026-11-27T02:00:00Z');

function harness(options: {
  readonly agency?: readonly RoutedEventRow[];
  readonly waiting?: readonly WaitingSafetyRelay[];
  readonly onShift?: readonly string[];
}) {
  const asked: NotificationRequest[] = [];
  const reads: RouterReads = {
    safetyEvents: () => Promise.resolve([]),
    events: () => Promise.resolve([]),
    agencyEvents: () => Promise.resolve(options.agency ?? []),
    waitingSafety: () => Promise.resolve(options.waiting ?? []),
    lines: () => Promise.reject(new Error('not read here')),
    creators: () => Promise.resolve([{ id: NORA, name: 'Nora' }]),
    owners: () =>
      Promise.resolve([
        { userId: 'owner-1', timeZone: 'Europe/Paris' },
        { userId: 'owner-2', timeZone: 'Europe/Paris' },
      ]),
    managers: () => Promise.resolve([{ userId: 'manager', timeZone: 'Europe/Paris', creatorIds: [NORA] }]),
    members: (ids) =>
      Promise.resolve(ids.map((id) => ({ userId: `user-of-${id}`, timeZone: 'Europe/Paris' }))),
  };
  const deps = {
    reads,
    onShift: () => Promise.resolve((options.onShift ?? []).map((memberId) => ({ memberId }))),
    notify: (request: NotificationRequest) => {
      asked.push(request);
      return Promise.resolve('rang' as const);
    },
  };
  return { asked, route: () => routeAgencyAlerts(deps, NOW), remind: () => remindSafety(deps, NOW) };
}

describe('alerts.agency (27/11/2026, Telegram back to the channels only)', () => {
  it('tells every owner an urgent alert through the night, keyed by the event', async () => {
    const h = harness({
      agency: [
        {
          id: 'event-1',
          creatorId: null,
          type: 'ai_quota_exhausted',
          payload: { provider: 'xai', mode: 'credits' },
        },
      ],
    });
    expect(await h.route()).toBe(2);
    expect(h.asked.map((r) => [r.userId, r.reason, r.objectKey])).toEqual([
      ['owner-1', 'agency_urgent', 'event-1'],
      ['owner-2', 'agency_urgent', 'event-1'],
    ]);
    expect(h.asked[0]?.message).toMatchObject({
      title: 'Urgent · Quota IA épuisé',
      url: '/reglages/consommation-ia',
    });
  });

  it('holds an important alert for the morning, with her name, and never a fan', async () => {
    const h = harness({
      agency: [
        {
          id: 'event-2',
          creatorId: NORA,
          type: 'handoff_requested',
          payload: { conversationId: CONVERSATION, cause: 'llm_unavailable' },
        },
      ],
    });
    await h.route();
    expect(h.asked[0]).toMatchObject({
      reason: 'agency_alert',
      message: {
        title: 'Nora · L’agent attend un humain',
        body: 'Le modèle ne répond plus. L’agent n’écrit plus à ce fan et attend un humain.',
        url: `/suivi?conversation=${CONVERSATION}`,
      },
    });
  });

  it('leaves a safety relay to her tab, and an archived creator’s event to nobody', async () => {
    const h = harness({
      agency: [
        {
          id: 'event-3',
          creatorId: NORA,
          type: 'handoff_requested',
          payload: { conversationId: CONVERSATION, cause: 'minor' },
        },
        {
          id: 'event-4',
          creatorId: ARCHIVED,
          type: 'handoff_requested',
          payload: { conversationId: CONVERSATION, cause: 'guard' },
        },
      ],
    });
    expect(await h.route()).toBe(0);
  });
});

describe('alerts.remind_safety (27/11/2026)', () => {
  it('rings nothing before 5 minutes, each slot of 5 up to an hour, then nothing', () => {
    const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    expect(safetyReminderDue(at(4), NOW)).toBeNull();
    expect(safetyReminderDue(at(5), NOW)).toBe(1);
    expect(safetyReminderDue(at(14), NOW)).toBe(2);
    expect(safetyReminderDue(at(60), NOW)).toBe(12);
    expect(safetyReminderDue(at(65), NOW)).toBeNull();
  });

  it('rings a relay nobody took again for the owners, her managers and the shift, once per slot', async () => {
    const h = harness({
      waiting: [
        {
          id: 'event-5',
          creatorId: NORA,
          conversationId: CONVERSATION,
          createdAt: new Date(NOW.getTime() - 11 * 60_000),
        },
      ],
      onShift: ['member-1'],
    });
    expect(await h.remind()).toBe(4);
    expect(h.asked.map((r) => [r.userId, r.reason, r.objectKey])).toEqual([
      ['owner-1', 'safety_alert', 'event-5:relance:2'],
      ['owner-2', 'safety_alert', 'event-5:relance:2'],
      ['manager', 'safety_alert', 'event-5:relance:2'],
      ['user-of-member-1', 'safety_alert', 'event-5:relance:2'],
    ]);
    expect(h.asked[0]?.message).toEqual({
      title: 'Nora · Relais de sécurité · personne ne l’a pris',
      body: 'L’IA a passé la main il y a 10 min et personne n’a repris la conversation.',
      url: `/suivi?conversation=${CONVERSATION}`,
    });
  });
});
