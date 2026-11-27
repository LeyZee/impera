import {
  ConversationIdSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertFeedbackFits,
  assertFeedbackNotExpired,
  assertNoFeedbackOwed,
  feedbackOwed,
  missingFeedbacks,
  type LastOpenedShift,
} from '../feedback-due';

const last = (over: Partial<LastOpenedShift> = {}): LastOpenedShift => ({
  id: newId(ShiftIdSchema),
  creatorId: newId(CreatorIdSchema),
  platformAccountId: newId(PlatformAccountIdSchema),
  memberId: newId(TeamMemberIdSchema),
  startsAt: new Date('2026-11-25T18:00:00Z'),
  endsAt: new Date('2026-11-26T00:00:00Z'),
  takesFeedback: true,
  hasFeedback: false,
  ...over,
});

describe('the light feedback (« ok rapport léger », 26/11)', () => {
  it('owes at most one feedback: his last opened shift, when it takes one and has none', () => {
    const shift = last();
    expect(feedbackOwed(shift)).toBe(shift);
    expect(feedbackOwed(last({ hasFeedback: true }))).toBeNull();
    expect(feedbackOwed(last({ takesFeedback: false }))).toBeNull();
    expect(feedbackOwed(null)).toBeNull();
  });

  it('refuses a feedback for any shift but his last opened one', () => {
    const shift = last();
    expect(() => {
      assertFeedbackNotExpired(shift.id, shift);
    }).not.toThrow();
    expect(() => {
      assertFeedbackNotExpired(newId(ShiftIdSchema), shift);
    }).toThrow(expect.objectContaining({ code: 'shift_feedback_expired_conflict' }));
    expect(() => {
      assertFeedbackNotExpired(shift.id, null);
    }).toThrow(expect.objectContaining({ code: 'shift_feedback_expired_conflict' }));
  });

  it('asks the feedback owed before « Je prends mon poste », naming its shift', () => {
    const owed = last();
    expect(() => {
      assertNoFeedbackOwed(newId(ShiftIdSchema), owed);
    }).toThrow(
      expect.objectContaining({
        code: 'shift_check_in_feedback_due_conflict',
        details: { shiftId: owed.id },
      }),
    );
    expect(() => {
      assertNoFeedbackOwed(owed.id, owed);
    }).not.toThrow();
    expect(() => {
      assertNoFeedbackOwed(newId(ShiftIdSchema), null);
    }).not.toThrow();
  });

  it('counts missing the shifts without feedback that are not their member’s last', () => {
    const member = newId(TeamMemberIdSchema);
    const older = { shiftId: newId(ShiftIdSchema), memberId: member };
    const latest = { shiftId: newId(ShiftIdSchema), memberId: member };
    const other = { shiftId: newId(ShiftIdSchema), memberId: newId(TeamMemberIdSchema) };
    expect(missingFeedbacks([older, latest, other], new Map([[member, latest.shiftId]]))).toEqual([
      older,
      other,
    ]);
  });
});

describe('what a feedback may say of its shift (ADR 0170 §§ 1 and 2)', () => {
  const fan = newId(ConversationIdSchema);
  const shift = { drafts: { asIs: 9, edited: 14, rejected: 0 }, fans: [{ conversationId: fan }] };
  const signal = { category: 'fan_request' as const, text: 'Une vidéo en tenue de sport' };

  it('links only a fan of the shift', () => {
    expect(() => {
      assertFeedbackFits({ signals: [{ ...signal, conversationId: fan }], draftReason: null }, shift);
    }).not.toThrow();
    expect(() => {
      assertFeedbackFits({ signals: [{ ...signal, conversationId: null }], draftReason: null }, shift);
    }).not.toThrow();
    expect(() => {
      assertFeedbackFits(
        { signals: [{ ...signal, conversationId: newId(ConversationIdSchema) }], draftReason: null },
        shift,
      );
    }).toThrow(expect.objectContaining({ code: 'shift_feedback_fan_conflict' }));
  });

  it('takes the closed answer only when the question was asked', () => {
    expect(() => {
      assertFeedbackFits({ signals: [], draftReason: 'not_her_voice' }, shift);
    }).not.toThrow();
    expect(() => {
      assertFeedbackFits(
        { signals: [], draftReason: 'too_long' },
        { ...shift, drafts: { asIs: 20, edited: 1, rejected: 0 } },
      );
    }).toThrow(expect.objectContaining({ code: 'shift_feedback_reason_conflict' }));
  });
});
