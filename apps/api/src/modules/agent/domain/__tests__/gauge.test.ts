import { describe, expect, it } from 'vitest';

import { GAUGE_EVERY, gaugeDue, holdsBackNow } from '../gauge';

describe('the gauge in the middle of the action (Charles 26/11)', () => {
  it('is due every few of her messages since the run started, never at its start', () => {
    expect(GAUGE_EVERY).toBe(3);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(gaugeDue)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      false,
    ]);
  });
});

describe('holding him back (Charles 26/11)', () => {
  it('holds him back when he is about to come, not once he came, nor on a message without the signal', () => {
    expect(holdsBackNow(['close_to_coming', 'explicit_language'])).toBe(true);
    expect(holdsBackNow(['close_to_coming', 'just_came'])).toBe(false);
    expect(holdsBackNow(['explicit_language'])).toBe(false);
    expect(holdsBackNow(undefined)).toBe(false);
  });
});
