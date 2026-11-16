import { describe, expect, it } from 'vitest';

import { revealTimes } from './reveal';

describe('revealTimes (Charles, 16/11: nobody sends three messages at once)', () => {
  it('shows the first bubble with the answer, as production sends it, and each next after its typing time', () => {
    expect(revealTimes([4000, 3000, 2500])).toEqual([0, 3000, 5500]);
    expect(revealTimes([])).toEqual([]);
  });
});
