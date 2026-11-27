import { describe, expect, it } from 'vitest';

import { lastPurchaseOf } from '../vault';

const bundle = (sentAt: string, priceMinor: number, isPaid: boolean) => ({
  ref: { platform: 'reveal' as const, id: sentAt },
  priceMinor,
  isPaid,
  sentAt,
  media: [],
});

describe('lastPurchaseOf (ADR 0128 § 1)', () => {
  it('is the newest priced bundle he bought', () => {
    expect(
      lastPurchaseOf({
        bundles: [
          bundle('2026-11-20T10:00:00.000Z', 1500, true),
          bundle('2026-11-25T10:00:00.000Z', 2500, false),
          bundle('2026-11-22T10:00:00.000Z', 2000, true),
        ],
      }),
    ).toEqual(new Date('2026-11-22T10:00:00.000Z'));
  });

  it('ignores free bundles and is null when he never bought', () => {
    expect(lastPurchaseOf({ bundles: [bundle('2026-11-25T10:00:00.000Z', 0, true)] })).toBeNull();
    expect(lastPurchaseOf({ bundles: [] })).toBeNull();
  });
});
