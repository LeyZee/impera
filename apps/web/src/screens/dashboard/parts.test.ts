import { describe, expect, it } from 'vitest';

import { besidePlacement } from './parts';

const phone = { width: 390, height: 844 };
const tip = { width: 180, height: 110 };

describe('besidePlacement', () => {
  it('sets a tapped column’s tip on the side with more room, its middle on the column’s', () => {
    // A middle column on a phone: more room on its left, the tip ends before the column starts.
    const column = { left: 195, right: 233, top: 120, bottom: 278 };
    const place = besidePlacement(column, tip, phone);
    expect(place.left + tip.width).toBeLessThanOrEqual(column.left);
    expect(place.top).toBe(144);
    // A first column: the tip goes right.
    expect(besidePlacement({ left: 60, right: 98, top: 120, bottom: 278 }, tip, phone).left).toBe(106);
  });

  it('keeps the tip inside the window', () => {
    const place = besidePlacement({ left: 150, right: 240, top: 0, bottom: 40 }, tip, phone);
    expect(place.left).toBeGreaterThanOrEqual(12);
    expect(place.left + tip.width).toBeLessThanOrEqual(phone.width - 12);
    expect(place.top).toBe(12);
  });
});
