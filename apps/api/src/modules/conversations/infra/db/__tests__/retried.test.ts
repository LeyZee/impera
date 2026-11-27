import { describe, expect, it } from 'vitest';

import { retriedOf } from '../reader';

describe('the answers set aside under a draft (IA-08)', () => {
  it('reads the guards of a first answer set aside from its guard trace', () => {
    expect(retriedOf({ softViolations: [], retried: ['ai_disclosure'] })).toEqual(['ai_disclosure']);
    expect(retriedOf({ softViolations: ['ai_tic'], retried: ['ai_disclosure', 'contact_info'] })).toEqual([
      'ai_disclosure',
      'contact_info',
    ]);
  });

  it('says none for a draft written at once, an old trace or a code no longer known', () => {
    expect(retriedOf({ softViolations: [] })).toEqual([]);
    expect(retriedOf({})).toEqual([]);
    expect(retriedOf(null)).toEqual([]);
    expect(retriedOf({ retried: 'ai_disclosure' })).toEqual([]);
    expect(retriedOf({ retried: ['not_a_guard', 'ai_disclosure'] })).toEqual(['ai_disclosure']);
  });
});
