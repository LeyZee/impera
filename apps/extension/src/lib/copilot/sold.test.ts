import type { CopilotAssist } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { soldBetween, type MoneySeen } from './sold';

/* Invented data (ADR 0010). */
const seen = (spentMinor: number, lastPurchaseAt: string | null, fanId = 'fan-a'): MoneySeen => ({
  fanId,
  money: { tier: null, spentMinor, lastPurchaseAt },
});

const offered: NonNullable<CopilotAssist['sale']> = {
  script: { name: 'Soirée d’essai', stepIndex: 1, stepCount: 4 },
  nextStep: { name: 'Étape 3', priceMinor: 1_500 },
  refusedSteps: [],
  usedObjections: [],
  customOrderOpen: false,
  offerPending: true,
};

describe('a sale paid, seen by the panel (maquette v4, cadre 9)', () => {
  it('sees a purchase when what he spent goes up and his last purchase moves', () => {
    expect(
      soldBetween(seen(4_500, '2026-11-26T20:00:00Z'), seen(6_000, '2026-11-27T21:02:00Z'), offered, 10),
    ).toEqual({ amountMinor: 1_500, stepName: 'Étape 3', seenAt: 10 });
  });

  it('names the step only when its price is the amount paid', () => {
    expect(
      soldBetween(seen(4_500, null), seen(5_000, '2026-11-27T21:02:00Z'), offered, 10)?.stepName,
    ).toBeNull();
    expect(
      soldBetween(seen(4_500, null), seen(6_000, '2026-11-27T21:02:00Z'), null, 10)?.stepName,
    ).toBeNull();
  });

  it('sees nothing on the first read, for another fan, or when nothing was bought', () => {
    expect(soldBetween(null, seen(6_000, '2026-11-27T21:02:00Z'), offered, 10)).toBeNull();
    expect(
      soldBetween(seen(4_500, null, 'fan-a'), seen(6_000, '2026-11-27T21:02:00Z', 'fan-b'), offered, 10),
    ).toBeNull();
    expect(
      soldBetween(seen(4_500, '2026-11-26T20:00:00Z'), seen(4_500, '2026-11-26T20:00:00Z'), offered, 10),
    ).toBeNull();
    // A new rate of his dollars moves the total without a purchase: no party.
    expect(
      soldBetween(seen(4_500, '2026-11-26T20:00:00Z'), seen(4_600, '2026-11-26T20:00:00Z'), offered, 10),
    ).toBeNull();
    expect(
      soldBetween(seen(4_500, '2026-11-26T20:00:00Z'), seen(4_000, '2026-11-27T21:00:00Z'), offered, 10),
    ).toBeNull();
  });
});
