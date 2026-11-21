import { describe, expect, it } from 'vitest';

import {
  ALERT_HISTORY_ERROR_CODES,
  alertTriggerReason,
  AlertTriggerItemSchema,
  AlertTriggerQuerySchema,
  MarkAlertTriggersSeenBodySchema,
  SAFETY_EVENTS,
  SAFETY_EVENT_LABELS,
  safetyEventReason,
} from './alert-history';
import { AlertTriggerSchema } from './alerts';

const CREATOR = '01900000-0000-7000-8000-000000000010';
const ALERT = '01900000-0000-7000-8000-000000000030';

describe('history of her alerts (P4-01)', () => {
  it('writes its line from the alert and the word she declared, never from the fan', () => {
    const custom = (matchedBy: 'keyword' | 'model', keyword?: string) =>
      AlertTriggerSchema.parse({ alert: { kind: 'custom', id: ALERT }, matchedBy, keyword });
    expect(alertTriggerReason(custom('keyword', 'appel'), 'Appel')).toBe(
      'Le fan a écrit « appel », un mot de l’alerte « Appel ».',
    );
    expect(alertTriggerReason(custom('model'), 'Appel')).toBe(
      'Le message du fan correspond à l’alerte « Appel ».',
    );
    const system = AlertTriggerSchema.parse({
      alert: { kind: 'system', code: 'keyword' },
      matchedBy: 'keyword',
      keyword: 'snap',
    });
    expect(alertTriggerReason(system, 'Mot-clé de sa persona')).toBe(
      'Le fan a écrit « snap », un mot surveillé de sa persona.',
    );
  });

  it('reads its filters from the query string', () => {
    expect(AlertTriggerQuerySchema.parse({ creatorId: CREATOR, seen: 'false' })).toMatchObject({
      seen: false,
      limit: 50,
    });
    expect(AlertTriggerQuerySchema.parse({ creatorId: CREATOR, alert: 'service_request' }).alert).toBe(
      'service_request',
    );
    expect(AlertTriggerQuerySchema.safeParse({ creatorId: CREATOR, alert: 'other' }).success).toBe(false);
    expect(AlertTriggerQuerySchema.safeParse({ seen: 'true' }).success).toBe(false);
  });

  it('names what the agent’s safety did, and filters on it (recette 16/11 AGE-05)', () => {
    for (const event of SAFETY_EVENTS) {
      expect(SAFETY_EVENT_LABELS[event].length).toBeGreaterThan(0);
      expect(safetyEventReason(event)).toMatch(/^Le /u);
      expect(AlertTriggerQuerySchema.parse({ creatorId: CREATOR, alert: event }).alert).toBe(event);
    }
    expect(safetyEventReason('care')).toContain('mode soin');
  });

  it('carries exactly one of the alert that rang and what the safety did', () => {
    const line = {
      id: '01900000-0000-7000-8000-000000000040',
      creatorId: CREATOR,
      conversationId: '01900000-0000-7000-8000-000000000050',
      fanId: '01900000-0000-7000-8000-000000000060',
      fanDisplayName: 'Hugo',
      trigger: null,
      safety: 'minor',
      alertGroupId: null,
      alertName: 'Âge douteux',
      pausedAgent: true,
      reason: safetyEventReason('minor'),
      at: '2026-11-16T05:00:00.000Z',
      seenAt: null,
    };
    expect(AlertTriggerItemSchema.safeParse(line).success).toBe(true);
    expect(AlertTriggerItemSchema.safeParse({ ...line, safety: null }).success).toBe(false);
    expect(
      AlertTriggerItemSchema.safeParse({
        ...line,
        trigger: { alert: { kind: 'custom', id: ALERT }, matchedBy: 'model' },
      }).success,
    ).toBe(false);
  });

  it('marks up to a trigger named by its id, never by a date', () => {
    expect(MarkAlertTriggersSeenBodySchema.safeParse({ creatorId: CREATOR, untilId: ALERT }).success).toBe(
      true,
    );
    expect(
      MarkAlertTriggersSeenBodySchema.safeParse({ creatorId: CREATOR, until: '2026-10-27T11:30:00Z' })
        .success,
    ).toBe(false);
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of ALERT_HISTORY_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid)$/u);
    }
  });
});
