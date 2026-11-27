import { describe, expect, it } from 'vitest';

import {
  draftReasonAsked,
  PutShiftFeedbackBodySchema,
  SHIFT_FEEDBACK_ERROR_CODES,
  SHIFT_FEEDBACK_SIGNALS_MAX,
} from './shift-feedback';

const body = {
  id: '0195f0c0-0000-7000-8000-0000000000aa',
  nothingToReport: false,
  comment: null,
  incident: null,
};
const parse = (overrides: object) => PutShiftFeedbackBodySchema.safeParse({ ...body, ...overrides }).success;
const signal = { category: 'fan_request', text: 'Un fan demande un audio' };

describe('mini feedback of a shift (ADR 0050 § 10)', () => {
  it('says something, or says there is nothing to report, never both, never neither', () => {
    expect(parse({ nothingToReport: true })).toBe(true);
    expect(parse({ comment: 'Soirée calme' })).toBe(true);
    expect(parse({ incident: 'Coupure de connexion' })).toBe(true);
    expect(parse({ signals: [signal] })).toBe(true);
    expect(parse({})).toBe(false);
    expect(parse({ nothingToReport: true, comment: 'Calme' })).toBe(false);
    expect(parse({ nothingToReport: true, signals: [signal] })).toBe(false);
  });

  it('turns blank texts into none, so blank is not something said', () => {
    expect(parse({ comment: '   ' })).toBe(false);
    const parsed = PutShiftFeedbackBodySchema.parse({ ...body, nothingToReport: true, comment: '  ' });
    expect([parsed.comment, parsed.signals]).toEqual([null, []]);
  });

  it('bounds the signals and their texts', () => {
    expect(parse({ signals: Array.from({ length: SHIFT_FEEDBACK_SIGNALS_MAX }, () => signal) })).toBe(true);
    expect(parse({ signals: Array.from({ length: SHIFT_FEEDBACK_SIGNALS_MAX + 1 }, () => signal) })).toBe(
      false,
    );
    expect(parse({ signals: [{ ...signal, text: 'x'.repeat(281) }] })).toBe(false);
    expect(parse({ signals: [{ ...signal, category: 'price' }] })).toBe(false);
    expect(parse({ comment: 'x'.repeat(1001) })).toBe(false);
  });

  it('names its errors with the suffix the server maps to a status', () => {
    for (const code of SHIFT_FEEDBACK_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|forbidden)$/u);
    }
  });

  it('links a signal to a fan by his conversation, or to nobody', () => {
    const linked = { ...signal, conversationId: '0195f0c0-0000-7000-8000-0000000000bb' };
    expect(parse({ signals: [linked] })).toBe(true);
    expect(parse({ signals: [{ ...signal, conversationId: 'pseudo' }] })).toBe(false);
    const parsed = PutShiftFeedbackBodySchema.parse({ ...body, signals: [signal] });
    expect(parsed.signals[0]?.conversationId).toBeNull();
    expect(
      parse({
        signals: [
          { ...signal, category: 'agent' },
          { ...signal, category: 'idea' },
        ],
      }),
    ).toBe(true);
  });

  it('takes a closed reason for the corrected drafts, or none', () => {
    expect(parse({ nothingToReport: true, draftReason: 'too_long' })).toBe(true);
    expect(parse({ nothingToReport: true, draftReason: 'boring' })).toBe(false);
    expect(PutShiftFeedbackBodySchema.parse({ ...body, nothingToReport: true }).draftReason).toBeNull();
  });
});

describe('the closed question on the drafts (ADR 0170 § 1)', () => {
  it('is asked from five drafts changed, when they are at least 40 % of his drafts', () => {
    expect(draftReasonAsked({ asIs: 0, edited: 4, rejected: 0 })).toBe(false);
    expect(draftReasonAsked({ asIs: 0, edited: 3, rejected: 2 })).toBe(true);
    expect(draftReasonAsked({ asIs: 9, edited: 14, rejected: 0 })).toBe(true);
    expect(draftReasonAsked({ asIs: 15, edited: 10, rejected: 0 })).toBe(true);
    expect(draftReasonAsked({ asIs: 16, edited: 10, rejected: 0 })).toBe(false);
  });
});
