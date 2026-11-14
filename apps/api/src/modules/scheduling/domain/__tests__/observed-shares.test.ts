import { PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { agencyShareChanges, observedShares, shareBps, type ObservedTotalsRow } from '../observed-shares';

// Everything below is invented (ADR 0010): the accounts, the amounts and the shares, never the agency's own.
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000b1');
const OTHER = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000b2');

function row(patch: Partial<ObservedTotalsRow> = {}): ObservedTotalsRow {
  return {
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    currency: 'EUR',
    netMinor: 10_000,
    agencyMinor: 3_500,
    ...patch,
  };
}

describe('the agency’s share read on the register (ADR 0054 § 4)', () => {
  it('rounds to the nearest basis point, a half up, in whole numbers', () => {
    expect(shareBps(3_500, 10_000)).toBe(3_500);
    expect(shareBps(1, 3)).toBe(3_333);
    expect(shareBps(2, 3)).toBe(6_667);
    expect(shareBps(1, 20_000)).toBe(1);
    expect(shareBps(1, 40_000)).toBe(0);
  });

  it('reads no share without a net, nor for a part out of it', () => {
    expect(shareBps(0, 0)).toBeNull();
    expect(shareBps(-10, 1_000)).toBeNull();
    expect(shareBps(1_200, 1_000)).toBeNull();
  });

  it('sums each account and currency apart, the platform’s amounts as they are', () => {
    const shares = observedShares([
      row(),
      row({ netMinor: 20_000, agencyMinor: 8_000 }),
      row({ currency: 'USD', netMinor: 5_000, agencyMinor: 2_000 }),
      row({ platformAccountId: OTHER, netMinor: 1_000, agencyMinor: 300 }),
    ]);
    expect(shares).toEqual([
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        netMinor: 30_000,
        agencyMinor: 11_500,
        agencyBps: 3_833,
      },
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'USD',
        netMinor: 5_000,
        agencyMinor: 2_000,
        agencyBps: 4_000,
      },
      {
        platform: 'reveal',
        platformAccountId: OTHER,
        currency: 'EUR',
        netMinor: 1_000,
        agencyMinor: 300,
        agencyBps: 3_000,
      },
    ]);
  });
});

describe('a change of share from one fortnight to the next (ADR 0054 § 5)', () => {
  it('says nothing within a point, what rounding sale by sale explains', () => {
    expect(agencyShareChanges([row()], [row({ agencyMinor: 3_600 })])).toEqual([]);
  });

  it('says a move of more than a point, with both shares', () => {
    expect(agencyShareChanges([row()], [row({ agencyMinor: 4_000 })])).toEqual([
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        previousAgencyBps: 3_500,
        agencyBps: 4_000,
      },
    ]);
  });

  it('compares nothing with a fortnight without a net, nor an account read once', () => {
    expect(agencyShareChanges([row({ netMinor: 0, agencyMinor: 0 })], [row({ agencyMinor: 5_000 })])).toEqual(
      [],
    );
    expect(agencyShareChanges([], [row({ agencyMinor: 5_000 })])).toEqual([]);
    expect(agencyShareChanges([row()], [row({ netMinor: -100, agencyMinor: -35 })])).toEqual([]);
  });

  it('keeps each currency apart', () => {
    const changes = agencyShareChanges(
      [row(), row({ currency: 'USD' })],
      [row(), row({ currency: 'USD', agencyMinor: 2_000 })],
    );
    expect(changes.map((change) => change.currency)).toEqual(['USD']);
  });
});
