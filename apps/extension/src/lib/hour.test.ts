import { describe, expect, it } from 'vitest';

import { hourOf } from './hour';

describe('hourOf', () => {
  it('writes the time the CRM’s way', () => {
    expect(hourOf(new Date(2026, 10, 6, 9, 5))).toBe('9 h 05');
    expect(hourOf(new Date(2026, 10, 6, 18, 20))).toBe('18 h 20');
  });
});
