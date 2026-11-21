import { describe, expect, it } from 'vitest';

import { FAN_FOLD_FROM, FAN_FOLD_TO, FanListQuerySchema, foldPseudonym } from './fan-list';

describe('the list of fans (ADR 0124)', () => {
  it('folds a pseudonym as Suivi does: no accent, lower case', () => {
    expect(foldPseudonym('  Élodie ')).toBe('elodie');
    expect(foldPseudonym('ÇÀÏ')).toBe('cai');
  });

  it('gives the server one plain letter for each accented one, the same fold as the screen', () => {
    // Each one a single UTF-16 unit: `translate` maps them one for one.
    expect(FAN_FOLD_FROM).toHaveLength(FAN_FOLD_TO.length);
    for (let index = 0; index < FAN_FOLD_FROM.length; index += 1) {
      const letter = FAN_FOLD_FROM.charAt(index);
      // ø, ł and đ have no accent to take off: their plain letter is written by hand.
      if (!'øłđ'.includes(letter)) expect(foldPseudonym(letter)).toBe(FAN_FOLD_TO.charAt(index));
    }
  });

  it('reads « Ont décroché » at 21 days and the latest message first by default', () => {
    expect(FanListQuerySchema.parse({ creatorId: '7d4f3c1e-8a2b-4c5d-9e6f-0a1b2c3d4e5f' })).toMatchObject({
      filter: 'all',
      sort: 'last_message',
      period: 'month',
      lapsedDays: 21,
      limit: 50,
    });
  });
});
