import { describe, expect, it } from 'vitest';

import { waitingSince } from './model';

describe('waitingSince', () => {
  const now = new Date('2026-11-04T10:00:00Z');
  it('says how long a message has waited, in hours then in days', () => {
    expect(waitingSince('2026-11-04T09:30:00Z', now)).toBe('depuis moins d’une heure');
    expect(waitingSince('2026-11-04T05:00:00Z', now)).toBe('depuis 5 h');
    expect(waitingSince('2026-11-02T09:00:00Z', now)).toBe('depuis 2 j');
  });
});
