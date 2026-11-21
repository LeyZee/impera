import { AiForecastSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { aiForecast, paceOf, type ForecastInput, type ForecastRow } from '../forecast';

const TODAY = '2026-11-21';
const HER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

function day(offset: number): string {
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

function row(overrides: Partial<ForecastRow> = {}): ForecastRow {
  return { day: day(-1), line: 'chatting', creatorId: HER, usd: 11, conversations: 0, ...overrides };
}

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    rows: [],
    sales: [],
    creatorNames: new Map([[HER, 'Créatrice A']]),
    today: TODAY,
    usdPerEur: 1.1,
    capEur: 20,
    ...overrides,
  };
}

/** Fourteen full days: the week before at `before` €, the latest one at `latest` €, all chatting. */
function twoWeeks(before: number, latest: number, conversations = 10): ForecastRow[] {
  return Array.from({ length: 14 }, (_, i) =>
    row({ day: day(i - 14), usd: (i < 7 ? before : latest) * 1.1, conversations }),
  );
}

describe('paceOf', () => {
  it('reads the latest week as realistic and the two weeks as the band', () => {
    expect(paceOf([1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3])).toEqual({ low: 1, realistic: 3, high: 3 });
    expect(paceOf([5, 5, 5, 5, 5, 5, 5, 3, 3, 3, 3, 3, 3, 3])).toEqual({ low: 3, realistic: 3, high: 5 });
  });

  it('widens a fixed band under eight days', () => {
    expect(paceOf([2, 2, 2])).toEqual({ low: 1.6, realistic: 2, high: 2.5 });
  });
});

describe('aiForecast', () => {
  it('is null before a first full day with a call', () => {
    expect(aiForecast(input())).toBeNull();
    expect(aiForecast(input({ rows: [row({ day: TODAY })] }))).toBeNull();
  });

  it('adds the month so far to the pace for each day left, and a whole next month', () => {
    const rows = [...twoWeeks(5, 10), row({ day: TODAY, usd: 4.4 })];
    const forecast = aiForecast(input({ rows }));
    expect(forecast).not.toBeNull();
    expect(AiForecastSchema.parse(forecast)).toEqual(forecast);
    // November so far: 7 days at 5 € from the 7th to the 13th, 7 at 10 € from the 14th to the 20th, 4 € today.
    expect(forecast?.thisMonth.monthSoFarEur).toBeCloseTo(109);
    // Nine days left after the 21st.
    expect(forecast?.thisMonth.realistic).toBeCloseTo(109 + 9 * 10);
    expect(forecast?.thisMonth.low).toBeCloseTo(109 + 9 * 5);
    expect(forecast?.nextMonth).toMatchObject({ month: '2026-12' });
    expect(forecast?.nextMonth.realistic).toBeCloseTo(31 * 10);
    expect(forecast?.basisDays).toBe(14);
  });

  it('splits by line and by creator, and leaves what belongs to no creator out of the creators', () => {
    const rows = [
      ...twoWeeks(10, 10),
      row({ line: 'telegram', usd: 1.1 }),
      row({ line: 'playground', creatorId: null, usd: 2.2 }),
      row({ creatorId: OTHER, usd: 1.1, conversations: 3 }),
    ];
    const forecast = aiForecast(input({ rows }));
    expect(forecast?.lines.map((l) => l.line)).toEqual(['chatting', 'playground', 'telegram']);
    expect(forecast?.creators.map((c) => c.name)).toEqual(['Créatrice A', OTHER.slice(0, 8)]);
  });

  it('prices a conversation-day and grows only the chatting with more traffic', () => {
    const rows = [
      ...twoWeeks(10, 10, 20),
      ...Array.from({ length: 7 }, (_, i) => row({ day: day(i - 7), line: 'media', usd: 1.1 })),
    ];
    const forecast = aiForecast(input({ rows }));
    expect(forecast?.conversationsPerDay).toBe(20);
    expect(forecast?.eurPerConversationDay).toBeCloseTo(0.5);
    // 11 € a day realistic (10 chatting, 1 media), 16 € with half as many conversations again.
    expect(forecast?.moreTraffic.nextMonthEur).toBeCloseTo(31 * 16);
    expect(forecast?.cap).toMatchObject({ reachedAtRealistic: false, reachedWithMoreTraffic: false });
  });

  it('says when the cap stops the agent', () => {
    const forecast = aiForecast(input({ rows: twoWeeks(25, 25), capEur: 20 }));
    expect(forecast?.cap).toMatchObject({ reachedAtRealistic: true, nextMonthMaxEur: 620 });
  });

  it('puts the cost against the sales of the same days, refunds taken off', () => {
    const sales = Array.from({ length: 14 }, (_, i) => ({ day: day(i - 14), creatorId: HER, netEur: 300 }));
    const forecast = aiForecast(input({ rows: twoWeeks(30, 30), sales }));
    expect(forecast?.sales?.nextMonthEur).toBeCloseTo(9300);
    expect(forecast?.sales?.aiShare).toBeCloseTo(0.1);
    expect(forecast?.sales?.aiShareSoFar).toBeCloseTo(0.1);
    expect(forecast?.creators[0]?.salesNextMonthEur).toBeCloseTo(9300);
    expect(forecast?.creators[0]?.aiShareSoFar).toBeCloseTo(0.1);
  });

  it('has no sales part when none was read', () => {
    expect(aiForecast(input({ rows: twoWeeks(1, 1) }))?.sales).toBeNull();
  });
});
