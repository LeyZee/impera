import { describe, expect, it } from 'vitest';

import { shootDayDone, shootItemTimely } from '../week';

describe('the lines of a shooting day (ADR 0140 § 24)', () => {
  it('may be ticked ahead of the day and until two days after it', () => {
    expect(shootItemTimely('2026-11-25', '2026-11-20')).toBe(true);
    expect(shootItemTimely('2026-11-25', '2026-11-25')).toBe(true);
    expect(shootItemTimely('2026-11-25', '2026-11-27')).toBe(true);
    expect(shootItemTimely('2026-11-25', '2026-11-28')).toBe(false);
  });

  it('make the day done only when every one of them is, and a day without lines never', () => {
    expect(shootDayDone([{ done: true }, { done: true }])).toBe(true);
    expect(shootDayDone([{ done: true }, { done: false }])).toBe(false);
    expect(shootDayDone([])).toBe(false);
  });
});
