import { PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  AGENCY_SHARE_CHANGE_MIN_NET_MINOR,
  agencyShareChanges,
  observedShares,
  shareBps,
  sharesAgainstRates,
  type ObservedTotalsRow,
} from '../observed-shares';

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

  it('compares nothing with a fortnight of a few cents, whose share is rounding (PAY-04)', () => {
    // 0,03 € of net and 0,01 € for the agency: 33,33 %, then 37,5 % on 0,08 €. No alert.
    expect(
      agencyShareChanges([row({ netMinor: 3, agencyMinor: 1 })], [row({ netMinor: 8, agencyMinor: 3 })]),
    ).toEqual([]);
    expect(agencyShareChanges([row()], [row({ netMinor: 1_999, agencyMinor: 1_000 })])).toEqual([]);
    expect(agencyShareChanges([row({ netMinor: 1_999, agencyMinor: 100 })], [row()])).toEqual([]);
    // From the floor on, the move counts.
    expect(
      agencyShareChanges(
        [row({ netMinor: AGENCY_SHARE_CHANGE_MIN_NET_MINOR, agencyMinor: 700 })],
        [row({ netMinor: AGENCY_SHARE_CHANGE_MIN_NET_MINOR, agencyMinor: 800 })],
      ),
    ).toEqual([
      {
        platform: 'reveal',
        platformAccountId: ACCOUNT,
        currency: 'EUR',
        previousAgencyBps: 3_500,
        agencyBps: 4_000,
      },
    ]);
  });

  it('keeps each currency apart', () => {
    const changes = agencyShareChanges(
      [row(), row({ currency: 'USD' })],
      [row(), row({ currency: 'USD', agencyMinor: 2_000 })],
    );
    expect(changes.map((change) => change.currency)).toEqual(['USD']);
  });
});

describe('the share read against her percentage (ADR 0054 § 2 and § 6)', () => {
  // One sale a day: the net, the agency's part and hers, as the platform reads them.
  const sale = (day: string, netMinor: number, agencyMinor: number) => ({
    ...row({ netMinor, agencyMinor }),
    day,
    sales: 1,
    refunds: 0,
    creatorMinor: netMinor - agencyMinor,
  });
  const rate = (fromDay: string, agencyBps: number) => ({ fromDay, agencyBps });

  it('flags a share far from the percentage, as the gap alert does', () => {
    const rows = [sale('2026-11-02', 10_000, 3_750), sale('2026-11-03', 20_000, 7_500)];
    const [share] = sharesAgainstRates(rows, [rate('2026-10-01', 4_000)]);
    expect(share).toMatchObject({ agencyBps: 3_750, differsFromRate: true });
  });

  it('keeps a share the rounding of each sale explains in line', () => {
    const rows = [sale('2026-11-02', 999, 400), sale('2026-11-03', 999, 399)];
    const [share] = sharesAgainstRates(rows, [rate('2026-10-01', 4_000)]);
    expect(share?.differsFromRate).toBe(false);
  });

  it('compares nothing without a percentage, nor on days before the first', () => {
    const rows = [sale('2026-11-02', 10_000, 3_750)];
    expect(sharesAgainstRates(rows, [])[0]?.differsFromRate).toBeNull();
    expect(sharesAgainstRates(rows, [rate('2026-11-10', 4_000)])[0]?.differsFromRate).toBeNull();
  });

  it('reads each day with the percentage in force on it', () => {
    const rows = [sale('2026-11-02', 10_000, 4_000), sale('2026-11-12', 10_000, 3_000)];
    const rates = [rate('2026-10-01', 4_000), rate('2026-11-10', 3_000)];
    expect(sharesAgainstRates(rows, rates)[0]?.differsFromRate).toBe(false);
  });
});
