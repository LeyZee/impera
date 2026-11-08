import { describe, expect, it } from 'vitest';

import { reviewOf } from './fixtures';
import { reviewSteps, standingLine } from './review';

const DROP = '0192f3a0-0000-7000-8000-000000000d01';
const FILES = [
  '0192f3a0-0000-7000-8000-000000000b01',
  '0192f3a0-0000-7000-8000-000000000b02',
  '0192f3a0-0000-7000-8000-000000000b03',
] as const;

describe('the review of a sent script (SC-04 lot c3)', () => {
  it('groups her media by step and leaves to « Tout valider » only what nothing holds back', () => {
    const steps = reviewSteps(
      reviewOf(DROP, FILES, { reasons: [[], ['unsure'], []], validated: [false, false, true] }),
    );
    expect(steps.map((step) => [step.code, step.media.length, step.batch.length, step.alone])).toEqual([
      ['E1', 1, 1, 0],
      ['E2A', 1, 0, 1],
      ['E2B', 1, 0, 0],
    ]);
  });

  it('says where the script stands in one line', () => {
    expect(standingLine(reviewOf(DROP, FILES))).toBe('3 descriptions à valider');
    expect(standingLine(reviewOf(DROP, FILES, { validated: [true, true, false] }))).toBe(
      '1 description à valider',
    );
    const all = [true, true, true];
    expect(standingLine(reviewOf(DROP, FILES, { validated: all }))).toBe('La synthèse s’écrit');
    expect(standingLine(reviewOf(DROP, FILES, { validated: all, summary: 'stale' }))).toBe(
      'La synthèse s’écrit',
    );
    expect(standingLine(reviewOf(DROP, FILES, { validated: all, summary: 'current' }))).toBe(
      'Synthèse à valider',
    );
    expect(standingLine(reviewOf(DROP, FILES, { validated: all, summary: 'validated' }))).toBe(
      'Tout est validé',
    );
    const waiting = reviewOf(DROP, FILES);
    const undescribed = {
      ...waiting,
      media: waiting.media.map((one, i) => (i === 0 ? { ...one, description: null } : one)),
    };
    expect(standingLine(undescribed)).toBe('1 média attend sa description');
  });
});
