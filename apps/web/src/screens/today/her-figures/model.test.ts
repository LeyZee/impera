import { describe, expect, it } from 'vitest';

import { herFiguresOf } from './model';

import { DEMO_INSIGHTS } from '@/screens/sales/insights-fixture';

describe('her three figures on Aujourd’hui', () => {
  it('gives three counts at most, rounded, never an exact count under ten', () => {
    const figures = herFiguresOf({
      ...DEMO_INSIGHTS,
      fans: { total: 1_240, newLast30Days: 80, wroteLast7Days: null },
    });
    expect(figures).toHaveLength(3);
    expect(figures.map((f) => f.value)).toEqual(['≈ 1 240', '≈ 80', 'moins de 10']);
  });
});
