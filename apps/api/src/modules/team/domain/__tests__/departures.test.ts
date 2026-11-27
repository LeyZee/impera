import { describe, expect, it } from 'vitest';

import { departureApplier, isLateDeparture } from '../departures';

const at = (iso: string) => new Date(iso);

describe('a departure at its hour (ADR 0166 § 2)', () => {
  it('is late only when still scheduled more than ten minutes after its hour', () => {
    const now = at('2026-11-21T18:00:00Z');
    const scheduled = { cancelledAt: null, appliedAt: null };
    expect(isLateDeparture({ ...scheduled, endsAt: at('2026-11-21T17:55:00Z') }, now)).toBe(false);
    expect(isLateDeparture({ ...scheduled, endsAt: at('2026-11-21T17:49:00Z') }, now)).toBe(true);
    expect(
      isLateDeparture({ endsAt: at('2026-11-21T17:00:00Z'), cancelledAt: null, appliedAt: now }, now),
    ).toBe(false);
    expect(
      isLateDeparture({ endsAt: at('2026-11-21T17:00:00Z'), cancelledAt: now, appliedAt: null }, now),
    ).toBe(false);
  });

  it('is applied by the owner who set it, or by an owner in office once he no longer is one', () => {
    expect(departureApplier('a', ['b', 'a'])).toBe('a');
    expect(departureApplier('a', ['b', 'c'])).toBe('b');
    expect(departureApplier('a', [])).toBe(null);
  });
});
