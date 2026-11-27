import { describe, expect, it } from 'vitest';

import { herFiguresOf } from './model';

import { DEMO_INSIGHTS } from '@/screens/sales/insights-fixture';

describe('her three figures on Aujourd’hui', () => {
  it('gives three counts at most, rounded, and leaves out a count under ten (recette 27/11, G3)', () => {
    const figures = herFiguresOf({
      ...DEMO_INSIGHTS,
      fans: { total: 1_240, newLast30Days: 80, wroteLast7Days: null },
    });
    expect(figures.map((f) => f.value)).toEqual(['≈ 1\u202f240', '≈ 80']);
    expect(
      herFiguresOf({ ...DEMO_INSIGHTS, fans: { total: null, newLast30Days: null, wroteLast7Days: null } }),
    ).toEqual([]);
  });
});
