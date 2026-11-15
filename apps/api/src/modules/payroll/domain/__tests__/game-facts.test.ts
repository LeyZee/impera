import { PayPeriodSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { payGameFacts } from '../game-facts';
import type { FigureLine } from '../my-figures';

const ZONE = 'Europe/Paris';
const MAY = PayPeriodSchema.parse('2025-05-01');
const JUNE = PayPeriodSchema.parse('2025-06-01');

const line = (
  period: FigureLine['period'],
  netMinor: number,
  at: string | null,
  currency: FigureLine['currency'] = 'EUR',
  event: FigureLine['event'] = 'sale',
): FigureLine => ({ period, event, currency, netMinor, occurredAt: at === null ? null : new Date(at) });

describe('payGameFacts (ADR 0104 § 12, § 14 to § 16)', () => {
  it('reads nothing from a member with no line', () => {
    expect(payGameFacts({ lines: [], tiers: [], agencyZone: ZONE, currentPeriod: JUNE })).toEqual({
      sales: 0,
      dayNetsMinor: [],
      closedPeriodNetsMinor: [],
      tiers: [],
      currency: null,
      cumulatedNetMinor: 0,
      timedNets: [],
    });
  });

  it('adds the net of every statement in the currency that brought the most, refunds taken off', () => {
    const facts = payGameFacts({
      lines: [
        line(MAY, 4_000, '2025-05-05T10:00:00Z'),
        line(MAY, -1_000, '2025-05-06T10:00:00Z', 'EUR', 'refund'),
        line(JUNE, 2_500, '2025-06-02T10:00:00Z'),
        line(JUNE, 900, null),
        line(JUNE, 700, '2025-06-02T11:00:00Z', 'USD'),
      ],
      tiers: [],
      agencyZone: ZONE,
      currentPeriod: JUNE,
    });
    expect(facts.currency).toBe('EUR');
    expect(facts.cumulatedNetMinor).toBe(6_400);
    // A line with no instant counts in the net, and in no shift.
    expect(facts.timedNets).toEqual([
      { at: new Date('2025-05-05T10:00:00Z'), netMinor: 4_000 },
      { at: new Date('2025-05-06T10:00:00Z'), netMinor: -1_000 },
      { at: new Date('2025-06-02T10:00:00Z'), netMinor: 2_500 },
    ]);
    expect(facts.closedPeriodNetsMinor).toEqual([3_000]);
  });
});
