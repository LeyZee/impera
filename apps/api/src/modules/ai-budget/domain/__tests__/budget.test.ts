import { describe, expect, it } from 'vitest';

import { capsProblem, effectiveCaps, NO_CAPS } from '../budget';

const DEFAULTS = { dailyCapMinor: 2000, trendWatchCapMinor: 100 };

describe('effectiveCaps', () => {
  it('takes the code’s default for each value the owner left empty', () => {
    expect(effectiveCaps(NO_CAPS, DEFAULTS)).toEqual(DEFAULTS);
    expect(effectiveCaps({ ...NO_CAPS, dailyCapMinor: 5000 }, DEFAULTS)).toEqual({
      dailyCapMinor: 5000,
      trendWatchCapMinor: 100,
    });
  });
});

describe('capsProblem', () => {
  it('refuses a watch cap above the day’s budget, the defaults included', () => {
    expect(capsProblem({ dailyCapMinor: 300, trendWatchCapMinor: 500 }, DEFAULTS)).toMatch(/compté dedans/u);
    // A budget of 0,50 € with the watch left at its default of 1 €.
    expect(capsProblem({ dailyCapMinor: 50, trendWatchCapMinor: null }, DEFAULTS)).not.toBeNull();
    expect(capsProblem({ dailyCapMinor: null, trendWatchCapMinor: 2000 }, DEFAULTS)).toBeNull();
    expect(capsProblem({ dailyCapMinor: 500, trendWatchCapMinor: 500 }, DEFAULTS)).toBeNull();
  });
});
