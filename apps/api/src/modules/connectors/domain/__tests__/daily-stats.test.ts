import type { PlatformDailyStat } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  dailyStatsRange,
  dailyStatsRows,
  hourAt,
  statsCallAllowed,
  type LinkedAccount,
} from '../daily-stats';

const PARIS = 'Europe/Paris';
const VERIFIED = new Date('2026-11-01T09:00:00Z');

describe('daily statistics (ADR 0081)', () => {
  it('moves a day across months and years', () => {
    expect(addDays('2026-11-07', -30)).toBe('2026-10-08');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
  });

  it('reads the hour in the platform’s zone, winter and summer', () => {
    expect(hourAt(new Date('2026-11-07T04:30:00Z'), PARIS)).toBe(5);
    expect(hourAt(new Date('2026-07-07T03:30:00Z'), PARIS)).toBe(5);
    expect(hourAt(new Date('2026-11-07T23:10:00Z'), PARIS)).toBe(0);
  });

  it('reads 31 days until a reading of 31 days went through since the key was verified', () => {
    const now = new Date('2026-11-07T13:00:00Z');
    expect(dailyStatsRange(now, PARIS, { fullReadAt: null, keyVerifiedAt: VERIFIED })).toEqual({
      from: '2026-10-08',
      to: '2026-11-07',
      full: true,
    });
    // A reconnection after the last 31 days: read them again.
    expect(
      dailyStatsRange(now, PARIS, {
        fullReadAt: new Date('2026-11-05T04:10:00Z'),
        keyVerifiedAt: new Date('2026-11-06T10:00:00Z'),
      }).full,
    ).toBe(true);
  });

  it('reads today and yesterday otherwise, in the platform’s day', () => {
    // 00:30 in Paris on the 8th: still the 7th in UTC.
    const now = new Date('2026-11-07T23:30:00Z');
    expect(
      dailyStatsRange(now, PARIS, { fullReadAt: new Date('2026-11-07T04:05:00Z'), keyVerifiedAt: VERIFIED }),
    ).toEqual({ from: '2026-11-07', to: '2026-11-08', full: false });
  });

  it('reads 31 days at 5 h in the platform’s zone, once within that hour', () => {
    const night = new Date('2026-11-07T04:07:00Z');
    expect(
      dailyStatsRange(night, PARIS, { fullReadAt: new Date('2026-11-06T04:07:00Z'), keyVerifiedAt: VERIFIED })
        .full,
    ).toBe(true);
    // Replayed in the same hour: the 31 days just read are not read again.
    expect(
      dailyStatsRange(new Date('2026-11-07T04:40:00Z'), PARIS, { fullReadAt: night, keyVerifiedAt: VERIFIED })
        .full,
    ).toBe(false);
    expect(
      dailyStatsRange(new Date('2026-11-07T06:07:00Z'), PARIS, {
        fullReadAt: new Date('2026-11-06T04:07:00Z'),
        keyVerifiedAt: VERIFIED,
      }).full,
    ).toBe(false);
  });

  it('leaves the reserve of 100 calls out of 500', () => {
    expect(statsCallAllowed(0)).toBe(true);
    expect(statsCallAllowed(399)).toBe(true);
    expect(statsCallAllowed(400)).toBe(false);
    expect(statsCallAllowed(520)).toBe(false);
  });

  it('keeps the linked models alone, counters only, a null left null', () => {
    const stat = (platformModelId: string): PlatformDailyStat => ({
      date: '2026-11-07',
      platformModelId,
      newSubscribers: 2,
      unsubscribes: null,
      activeSubscribers: 40,
      renewals: 1,
      ppvSent: null,
      ppvPurchased: 3,
      revenueInclVat: 1200,
      revenueExclVat: 1000,
      agency: 300,
      creator: 500,
      messagesSent: null,
      messagesReceived: 4,
    });
    const links = new Map<string, LinkedAccount>([
      ['model_test_01', { platformAccountId: 'account_01', creatorId: 'creator_01' }],
    ]);
    expect(dailyStatsRows('reveal', [stat('model_test_01'), stat('model_test_02')], links)).toEqual([
      {
        platform: 'reveal',
        platformAccountId: 'account_01',
        creatorId: 'creator_01',
        day: '2026-11-07',
        newSubscribers: 2,
        unsubscribes: null,
        activeSubscribers: 40,
        renewals: 1,
        ppvSent: null,
        ppvPurchased: 3,
        messagesSent: null,
        messagesReceived: 4,
      },
    ]);
  });
});
