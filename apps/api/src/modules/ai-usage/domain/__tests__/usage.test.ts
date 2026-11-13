import { AI_USAGE_DAYS, AiUsageSchema } from '@impera/contracts';
import type { AiCreditEntry } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  aiUsage,
  capState,
  countFrom,
  creditsOf,
  creditState,
  type UsageInput,
  type UsageRow,
} from '../usage';

const TODAY = '2026-11-11';
const CAP = { spentEur: 4, capEur: 20, alertAtEur: 16 };

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    day: TODAY,
    hour: 9,
    provider: 'xai',
    model: 'grok-4.7',
    use: 'voice',
    usd: 1.1,
    calls: 1,
    failed: 0,
    fallback: 0,
    inputTokens: 1000,
    outputTokens: 100,
    ...overrides,
  };
}

function input(overrides: Partial<UsageInput> = {}): UsageInput {
  return {
    rows: [],
    cap: CAP,
    today: TODAY,
    hour: 14,
    firstDay: null,
    lastCallAt: null,
    readAt: new Date('2026-11-11T13:30:00Z'),
    timeZone: 'Europe/Paris',
    usdPerEur: 1.1,
    entries: [],
    spentSinceUsd: {},
    quotaRefusedAt: {},
    ...overrides,
  };
}

describe('AI usage (ADR 0091)', () => {
  it('moves a day across a month and a year', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('tells the cap state as the gateway does', () => {
    expect(capState({ spentEur: 15.99, capEur: 20, alertAtEur: 16 })).toBe('ok');
    expect(capState({ spentEur: 16, capEur: 20, alertAtEur: 16 })).toBe('alert');
    expect(capState({ spentEur: 20, capEur: 20, alertAtEur: 16 })).toBe('reached');
  });

  it('answers the contract with no call at all: thirty empty days, the hours up to now, no pace', () => {
    const usage = aiUsage(input());
    expect(AiUsageSchema.parse(usage)).toEqual(usage);
    expect(usage.days).toHaveLength(AI_USAGE_DAYS);
    expect(usage.days[0]?.day).toBe('2026-10-13');
    expect(usage.days.at(-1)?.day).toBe(TODAY);
    expect(usage.hours.map((h) => h.hour)).toEqual(Array.from({ length: 15 }, (_, i) => i));
    expect(usage.pace).toEqual({
      perDayEur: null,
      perDayOver: 0,
      monthEur: 0,
      monthForecastEur: null,
      month: '2026-11',
    });
    expect(usage.models).toEqual([]);
    expect(usage.uses).toEqual([]);
  });

  it('converts dollars to euros at the cap rate and splits each day by provider', () => {
    const usage = aiUsage(
      input({
        rows: [
          row({ usd: 2.2 }),
          row({ provider: 'google', model: 'gemini-3.8-flash', use: 'sense', usd: 0.11, hour: 10 }),
          row({ day: '2026-11-10', usd: 1.1 }),
        ],
      }),
    );
    const today = usage.days.at(-1);
    expect(today?.eur).toBeCloseTo(2.1);
    expect(today?.calls).toBe(2);
    expect(today?.providers.map((p) => p.provider)).toEqual(['xai', 'google']);
    expect(today?.providers[0]?.eur).toBeCloseTo(2);
    expect(today?.providers[1]?.eur).toBeCloseTo(0.1);
    expect(usage.hours[9]?.eur).toBeCloseTo(2);
    expect(usage.hours[10]?.eur).toBeCloseTo(0.1);
    expect(usage.uses.map((u) => u.use)).toEqual(['voice', 'sense']);
  });

  it('takes today against the cap from the gateway, and counts its calls and failures from the journal', () => {
    const usage = aiUsage(input({ rows: [row({ calls: 5, failed: 2 })] }));
    expect(usage.today).toMatchObject({
      eur: 4,
      capEur: 20,
      alertAtEur: 16,
      state: 'ok',
      calls: 5,
      failed: 2,
    });
  });

  it('sums each model over the window, most expensive first, and leaves out older rows', () => {
    const usage = aiUsage(
      input({
        rows: [
          row({ usd: 1.1, calls: 2, fallback: 0, inputTokens: 10, outputTokens: 1 }),
          row({ day: '2026-11-01', usd: 1.1, calls: 3, failed: 1, inputTokens: 20, outputTokens: 2 }),
          row({ provider: 'mistral', model: 'mistral-large-4', usd: 0.55, calls: 1, fallback: 1 }),
          row({ day: '2026-10-01', usd: 100 }),
        ],
      }),
    );
    const [grok, mistral, ...others] = usage.models;
    expect(others).toEqual([]);
    expect(grok).toMatchObject({
      provider: 'xai',
      model: 'grok-4.7',
      calls: 5,
      failed: 1,
      fallback: 0,
      inputTokens: 30,
      outputTokens: 3,
    });
    expect(grok?.eur).toBeCloseTo(2);
    expect(mistral).toMatchObject({ provider: 'mistral', fallback: 1 });
    expect(mistral?.eur).toBeCloseTo(0.5);
  });

  it('averages the seven full days before today, never today', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ day: addDays(TODAY, -(i + 1)), usd: 7.7 }));
    const usage = aiUsage(input({ rows: [...rows, row({ usd: 110 })], firstDay: '2026-09-01' }));
    expect(usage.pace.perDayOver).toBe(7);
    expect(usage.pace.perDayEur).toBeCloseTo(7);
  });

  it('averages a new install over the days since its first call only', () => {
    const usage = aiUsage(
      input({
        rows: [row({ day: '2026-11-09', usd: 2.2 }), row({ day: '2026-11-10', usd: 4.4 })],
        firstDay: '2026-11-09',
      }),
    );
    expect(usage.pace.perDayOver).toBe(2);
    expect(usage.pace.perDayEur).toBeCloseTo(3);
  });

  it('has no average on the first day, and forecasts the month with the days left after today', () => {
    expect(aiUsage(input({ rows: [row()], firstDay: TODAY })).pace.perDayEur).toBeNull();
    const rows = [
      row({ day: '2026-10-31', usd: 11 }),
      row({ day: '2026-11-05', usd: 11 }),
      row({ day: '2026-11-10', usd: 11 }),
      row({ usd: 5.5 }),
    ];
    const usage = aiUsage(input({ rows, firstDay: '2026-10-20' }));
    // 10 € on the 5th and on the 10th over the 7 full days (the 31st is older); November so far 25 €; 19 days left.
    expect(usage.pace.perDayEur).toBeCloseTo(20 / 7);
    expect(usage.pace.monthEur).toBeCloseTo(25);
    expect(usage.pace.monthForecastEur).toBeCloseTo(25 + (20 / 7) * 19);
  });

  it('shows a credits card for each provider with a line, none for the others', () => {
    const entries = [entry({ provider: 'xai' })];
    const usage = aiUsage(input({ entries, spentSinceUsd: { xai: 1 } }));
    expect(usage.credits.map((c) => c.provider)).toEqual(['xai']);
    expect(AiUsageSchema.parse(usage)).toEqual(usage);
  });
});

let ids = 0;
function entry(overrides: Partial<AiCreditEntry> = {}): AiCreditEntry {
  ids += 1;
  return {
    id: `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`,
    provider: 'xai',
    kind: 'topup',
    amountMinor: 5000,
    currency: 'USD',
    at: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

const card = (overrides: Partial<Parameters<typeof creditsOf>[0]> = {}) =>
  creditsOf({
    provider: 'xai',
    quotaRefusedAt: null,
    entries: [entry()],
    spentSinceUsd: 0,
    perDayUsd: null,
    today: TODAY,
    usdPerEur: 1.1,
    ...overrides,
  });

describe('AI paid by a subscription (ADR 0091 § 6)', () => {
  const plan = (at: string): AiCreditEntry =>
    entry({ kind: 'subscription', amountMinor: 0, currency: 'USD', at });

  it('counts nothing from a subscription line, and goes back to credits after a later top-up or reading', () => {
    const topup = entry({ at: '2026-11-01T10:00:00.000Z' });
    const subscribed = plan('2026-11-05T10:00:00.000Z');
    const later = entry({ at: '2026-11-08T10:00:00.000Z', amountMinor: 2000 });
    expect(countFrom([topup, subscribed])).toBe(subscribed);
    // The top-up before the subscription is no longer counted.
    expect(countFrom([topup, subscribed, later])).toBe(later);
    expect(card({ entries: [topup, subscribed, later], spentSinceUsd: 5 })).toMatchObject({
      mode: 'credits',
      balanceMinor: 1500,
    });
  });

  it('shows what the calls would have cost since, never a balance nor a runway', () => {
    expect(
      card({ entries: [entry(), plan('2026-11-10T11:00:00.000Z')], spentSinceUsd: 3.21, perDayUsd: 1.07 }),
    ).toMatchObject({
      mode: 'subscription',
      balanceMinor: 0,
      spentSinceMinor: 321,
      perDayMinor: 107,
      daysLeft: null,
      runsOutOn: null,
      state: 'included',
      quotaRefusedAt: null,
    });
  });

  it('says the quota is reached while the provider refuses, on a subscription or on credits', () => {
    const at = new Date('2026-11-12T22:35:00.000Z');
    expect(card({ entries: [plan('2026-11-10T11:00:00.000Z')], quotaRefusedAt: at })).toMatchObject({
      state: 'quota_reached',
      quotaRefusedAt: at.toISOString(),
    });
    expect(card({ quotaRefusedAt: at })).toMatchObject({ mode: 'credits', quotaRefusedAt: at.toISOString() });
  });
});

describe('AI credits (ADR 0091 § 3)', () => {
  it('counts from the latest balance reading, else from the first top-up', () => {
    const first = entry({ at: '2026-11-01T10:00:00.000Z' });
    const reading = entry({ kind: 'balance', at: '2026-11-05T10:00:00.000Z' });
    const later = entry({ at: '2026-11-08T10:00:00.000Z' });
    expect(countFrom([later, first])).toBe(first);
    expect(countFrom([later, reading, first])).toBe(reading);
    expect(countFrom([])).toBeNull();
  });

  it('adds the top-ups since the reading and takes off what the calls cost since', () => {
    const entries = [
      entry({ amountMinor: 10_000, at: '2026-11-01T10:00:00.000Z' }),
      entry({ kind: 'balance', amountMinor: 3000, at: '2026-11-05T10:00:00.000Z' }),
      entry({ amountMinor: 2000, at: '2026-11-08T10:00:00.000Z' }),
    ];
    const result = card({ entries, spentSinceUsd: 12.5, perDayUsd: 5 });
    expect(result).toMatchObject({
      currency: 'USD',
      balanceMinor: 3000 + 2000 - 1250,
      spentSinceMinor: 1250,
      countedFrom: '2026-11-05T10:00:00.000Z',
      perDayMinor: 500,
      daysLeft: 7.5,
      runsOutOn: '2026-11-18',
      state: 'ok',
    });
    expect(result?.entries.map((e) => e.at)).toEqual([
      '2026-11-08T10:00:00.000Z',
      '2026-11-05T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z',
    ]);
  });

  it('counts a first top-up as the start, itself included', () => {
    expect(card({ spentSinceUsd: 10 })?.balanceMinor).toBe(4000);
  });

  it('shows every figure in the currency of the latest line, at the cap rate', () => {
    const entries = [
      entry({ amountMinor: 11_000, currency: 'USD', at: '2026-11-01T10:00:00.000Z' }),
      entry({ amountMinor: 5000, currency: 'EUR', at: '2026-11-02T10:00:00.000Z' }),
    ];
    // 110 $ = 100 €, + 50 €, minus 11 $ = 10 €.
    expect(card({ entries, spentSinceUsd: 11 })).toMatchObject({ currency: 'EUR', balanceMinor: 14_000 });
  });

  it('turns amber under five days, red under two, empty at zero, and says when the pace is unknown', () => {
    expect(creditState(1000, 5)).toBe('ok');
    expect(creditState(1000, 4.9)).toBe('low');
    expect(creditState(1000, 1.9)).toBe('critical');
    expect(creditState(0, 10)).toBe('empty');
    expect(creditState(-5, null)).toBe('empty');
    expect(creditState(1000, null)).toBe('unknown_pace');
    expect(card()).toMatchObject({ daysLeft: null, runsOutOn: null, state: 'unknown_pace' });
    // Nothing spent over the pace's days: the balance does not go down.
    expect(card({ perDayUsd: 0 })).toMatchObject({ daysLeft: null, runsOutOn: null, state: 'ok' });
    expect(card({ perDayUsd: 0, spentSinceUsd: 60 })).toMatchObject({ state: 'empty' });
  });

  it('runs out today when the calls went past what was written down', () => {
    expect(card({ spentSinceUsd: 60, perDayUsd: 10 })).toMatchObject({
      balanceMinor: -1000,
      daysLeft: 0,
      runsOutOn: TODAY,
      state: 'empty',
    });
  });

  it('keeps the ten latest lines', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry({ at: new Date(Date.UTC(2026, 10, 1 + i)).toISOString() }),
    );
    expect(card({ entries })?.entries).toHaveLength(10);
    expect(card({ entries: [] })).toBeNull();
  });
});
