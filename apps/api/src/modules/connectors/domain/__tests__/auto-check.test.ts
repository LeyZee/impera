import {
  PlatformAccountIdSchema,
  newId,
  type SalesFeedCheckDay,
  type SalesFeedCheckReport,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { fortnightBefore, mismatchDays } from '../auto-check';

const A = newId(PlatformAccountIdSchema);
const B = newId(PlatformAccountIdSchema);
const totals = (net: number | null) => ({ grossInclVat: null, agency: null, creator: null, net });

function day(
  date: string,
  platformModelId: string,
  register: number | null,
  stats: number | null,
): SalesFeedCheckDay {
  return {
    date,
    platformModelId,
    handle: null,
    linked: true,
    register: totals(register),
    stats: stats === null ? null : totals(stats),
    export: null,
    differs: register === stats ? [] : ['stats'],
  };
}

function report(days: SalesFeedCheckDay[]): SalesFeedCheckReport {
  return {
    platform: 'reveal',
    from: '2026-10-16',
    to: '2026-10-31',
    timeZone: 'Europe/Paris',
    generatedAt: '2026-11-02T06:00:00.000Z',
    registerReadAt: null,
    verdict: 'mismatch',
    total: { register: totals(0), stats: null, export: null },
    days,
    chatters: [],
    notes: [],
  };
}

describe('the automatic check (CRM-04 b3)', () => {
  it('checks the fortnight just over in the platform’s zone', () => {
    expect(fortnightBefore(new Date('2026-11-02T06:00:00Z'), 'Europe/Paris')).toEqual({
      from: '2026-10-16',
      to: '2026-10-31',
    });
    expect(fortnightBefore(new Date('2026-11-17T06:00:00Z'), 'Europe/Paris')).toEqual({
      from: '2026-11-01',
      to: '2026-11-15',
    });
    // 23:30 UTC on the 15th is already the 16th in Paris.
    expect(fortnightBefore(new Date('2026-11-15T23:30:00Z'), 'Europe/Paris').from).toBe('2026-11-01');
  });

  it('keeps the days whose nets differ, on the checked accounts only, both sources giving the net', () => {
    const models = new Map([
      ['model_a', A],
      ['model_b', B],
    ]);
    const found = mismatchDays(
      report([
        day('2026-10-20', 'model_a', 800, 1600),
        day('2026-10-18', 'model_a', 800, 800),
        // Not checked: paid on the declared figures.
        day('2026-10-19', 'model_b', 800, 0),
        // Linked to no account.
        day('2026-10-19', 'model_c', 800, 0),
        // The statistics do not say that day.
        day('2026-10-17', 'model_a', 800, null),
        day('2026-10-16', 'model_a', 1600, 800),
      ]),
      models,
      [{ platformAccountId: A, currency: 'EUR' }],
    );
    expect(found).toEqual([
      {
        day: '2026-10-16',
        platformAccountId: A,
        currency: 'EUR',
        registerNetMinor: 1600,
        platformNetMinor: 800,
        differenceMinor: -800,
      },
      {
        day: '2026-10-20',
        platformAccountId: A,
        currency: 'EUR',
        registerNetMinor: 800,
        platformNetMinor: 1600,
        differenceMinor: 800,
      },
    ]);
  });
});
