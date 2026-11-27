import { PUSH_BODY_MAX, ShiftFeedbackIdSchema, newId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { incidentNotices, type IncidentFacts } from '../incident-notice';

/** Invented people and creators only (ADR 0010). */
const facts: IncidentFacts = {
  feedbackId: newId(ShiftFeedbackIdSchema),
  authorUserId: 'user-basile',
  memberName: 'Basile',
  creatorName: 'Inès',
  shiftStartsAt: new Date('2026-11-20T09:00:00Z'),
  shiftEndsAt: new Date('2026-11-20T11:00:00Z'),
};

describe('incidentNotices (trous béants n° 1)', () => {
  it('tells each owner and manager in their own zone, never the author, never the incident’s words', () => {
    const notices = incidentNotices(facts, [
      { userId: 'user-owner', timeZone: 'Europe/Paris' },
      { userId: 'user-nora', timeZone: 'America/Montreal' },
      { userId: 'user-basile', timeZone: 'Europe/Paris' },
    ]);
    expect(notices.map((one) => one.userId)).toEqual(['user-owner', 'user-nora']);
    expect(notices[0]?.message.body).toBe('Basile signale un incident sur Inès, shift de 10 h – 12 h.');
    expect(notices[1]?.message.body).toBe('Basile signale un incident sur Inès, shift de 4 h – 6 h.');
    for (const notice of notices) {
      expect(notice).toMatchObject({
        reason: 'team',
        objectKey: `shift-incident:${facts.feedbackId}`,
        message: { title: 'Incident signalé', url: '/equipe/rapports' },
      });
      expect(notice.message.tag?.length).toBeLessThanOrEqual(64);
    }
  });

  it('keeps a long name within the length of a push', () => {
    const [notice] = incidentNotices({ ...facts, memberName: 'B'.repeat(400) }, [
      { userId: 'user-owner', timeZone: 'Europe/Paris' },
    ]);
    expect(notice?.message.body?.length).toBe(PUSH_BODY_MAX);
  });
});
