import { describe, expect, it } from 'vitest';

import { revealTimes } from './reveal';

describe('revealTimes (Charles, 16/11: nobody sends three messages at once)', () => {
  it('shows each bubble after her typing time, the time already spent writing counting toward the first', () => {
    expect(revealTimes([4000, 3000, 2500], 1000)).toEqual([3000, 6000, 8500]);
    expect(revealTimes([4000, 3000], 30_000)).toEqual([0, 3000]);
    expect(revealTimes([], 0)).toEqual([]);
  });
});
