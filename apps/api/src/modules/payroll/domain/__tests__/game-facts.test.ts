import { PayPeriodSchema, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { payGameFacts, reportLines, type ValidatedShift } from '../game-facts';
import type { FigureLine } from '../my-figures';

const ZONE = 'Europe/Paris';
const MAY = PayPeriodSchema.parse('2025-05-01');
const JUNE = PayPeriodSchema.parse('2025-06-01');
const ACCOUNT = PlatformAccountIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const OTHER_ACCOUNT = PlatformAccountIdSchema.parse('00000000-0000-4000-8000-0000000000a2');

const line = (
  period: FigureLine['period'],
  netMinor: number,
  at: string | null,
  currency: FigureLine['currency'] = 'EUR',
  event: FigureLine['event'] = 'sale',
  platformAccountId: FigureLine['platformAccountId'] = ACCOUNT,
): FigureLine => ({
  period,
  platformAccountId,
  event,
  currency,
  netMinor,
  occurredAt: at === null ? null : new Date(at),
  saleType: 'ppv',
});

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

describe('the validated reports in the game (ADR 0118 § 1 to § 4)', () => {
  const shift = (
    startsAt: string,
    grossMinor: number,
    over: Partial<ValidatedShift> = {},
  ): ValidatedShift => ({
    platformAccountId: ACCOUNT,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 4 * 3_600_000),
    period: JUNE,
    currency: 'EUR',
    grossMinor,
    vatBps: 2_000,
    platformFeeBps: 2_000,
    ...over,
  });

  it('counts a validated shift at the net of its total, on the day and at the hour its shift began', () => {
    // 120,00 declared: 100,00 without VAT, 80,00 without the platform's commission.
    expect(reportLines([shift('2025-06-03T18:00:00Z', 12_000)], [])).toEqual([
      {
        period: JUNE,
        platformAccountId: ACCOUNT,
        event: 'sale',
        currency: 'EUR',
        netMinor: 8_000,
        occurredAt: new Date('2025-06-03T18:00:00Z'),
        saleType: null,
      },
    ]);
  });

  it('leaves a shift to its sales as soon as one was read in its hours: one source a shift', () => {
    const read = [line(JUNE, 3_000, '2025-06-03T19:30:00Z')];
    expect(reportLines([shift('2025-06-03T18:00:00Z', 12_000)], read)).toEqual([]);
    // A sale read at the minute the shift ends belongs to the next one; a line with no instant shadows nothing.
    expect(
      reportLines([shift('2025-06-03T18:00:00Z', 12_000)], [line(JUNE, 1, '2025-06-03T22:00:00Z')]),
    ).toHaveLength(1);
    expect(reportLines([shift('2025-06-03T18:00:00Z', 12_000)], [line(JUNE, 1, null)])).toHaveLength(1);
  });

  it('keeps the report of a shift when the sale read in its hours is another account’s', () => {
    const elsewhere = [line(JUNE, 3_000, '2025-06-03T19:30:00Z', 'EUR', 'sale', OTHER_ACCOUNT)];
    expect(reportLines([shift('2025-06-03T18:00:00Z', 12_000)], elsewhere)).toHaveLength(1);
    // Two shifts in the same hours, one on each account: only the one whose account has the sale is left to it.
    expect(
      reportLines(
        [
          shift('2025-06-03T18:00:00Z', 12_000),
          shift('2025-06-03T18:00:00Z', 6_000, { platformAccountId: OTHER_ACCOUNT }),
        ],
        elsewhere,
      ).map((one) => one.platformAccountId),
    ).toEqual([ACCOUNT]);
  });

  it('brings no line for a total of zero or less', () => {
    expect(reportLines([shift('2025-06-03T18:00:00Z', 0), shift('2025-06-04T18:00:00Z', -500)], [])).toEqual(
      [],
    );
  });

  it('feeds the first sale, the days, the fortnights, the cumulated net and the timed nets', () => {
    const facts = payGameFacts({
      lines: [line(JUNE, 2_000, '2025-06-10T10:00:00Z')],
      validatedShifts: [
        shift('2025-05-05T18:00:00Z', 12_000, { period: MAY }),
        shift('2025-06-03T18:00:00Z', 6_000),
        // Shadowed by the sale read at 10:00 that day.
        shift('2025-06-10T08:00:00Z', 60_000),
      ],
      tiers: [],
      agencyZone: ZONE,
      currentPeriod: JUNE,
    });
    expect(facts.sales).toBe(3);
    expect(facts.cumulatedNetMinor).toBe(8_000 + 4_000 + 2_000);
    expect(facts.closedPeriodNetsMinor).toEqual([8_000]);
    expect(facts.dayNetsMinor).toEqual([8_000, 4_000, 2_000]);
    expect(facts.timedNets).toContainEqual({ at: new Date('2025-06-03T18:00:00Z'), netMinor: 4_000 });
  });

  it('gives back what a refused report had given: it is no longer read, so its net is gone', () => {
    const before = payGameFacts({
      lines: [],
      validatedShifts: [shift('2025-06-03T18:00:00Z', 12_000)],
      tiers: [],
      agencyZone: ZONE,
      currentPeriod: JUNE,
    });
    const after = payGameFacts({
      lines: [],
      validatedShifts: [],
      tiers: [],
      agencyZone: ZONE,
      currentPeriod: JUNE,
    });
    expect(before.cumulatedNetMinor).toBe(8_000);
    expect(after.cumulatedNetMinor).toBe(0);
    expect(after.sales).toBe(0);
  });
});
