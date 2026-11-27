import { AiForecastSchema, AiUsageSchema, type AiForecast, type AiUsage } from '@impera/contracts';

/**
 * An invented month of AI spend (ADR 0010: no real figure), for the tests of Réglages › Consommation IA. Parsed with
 * the contract: a field it no longer has fails here first.
 */
export function usageFixture(overrides: Partial<AiUsage> = {}): AiUsage {
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 9, 13 + i)).toISOString().slice(0, 10);
    const xai = 2 + (i % 5) * 0.6;
    const google = i % 3 === 0 ? 0.4 : 0.15;
    // Grok on the subscription from the 9th of November (ADR 0091 § 6).
    const covered = day >= '2026-11-09' ? xai : 0;
    return {
      day,
      eur: xai + google,
      coveredEur: covered,
      calls: 300 + i * 7,
      providers: [
        { provider: 'xai', eur: xai, coveredEur: covered },
        { provider: 'google', eur: google, coveredEur: 0 },
      ],
    };
  });
  return AiUsageSchema.parse({
    readAt: '2026-11-11T13:30:00.000Z',
    timeZone: 'Europe/Paris',
    usdPerEur: 1.1,
    today: {
      day: '2026-11-11',
      eur: 4.2,
      coveredEur: 3.6,
      capEur: 25,
      alertAtEur: 20,
      state: 'ok',
      calls: 412,
      failed: 3,
    },
    hours: Array.from({ length: 15 }, (_, hour) => ({
      hour,
      eur: hour < 8 ? 0.05 : 0.45,
      coveredEur: hour < 8 ? 0.05 : 0.4,
      calls: hour < 8 ? 4 : 41,
      providers: [
        { provider: 'xai', eur: hour < 8 ? 0.05 : 0.4, coveredEur: hour < 8 ? 0.05 : 0.4 },
        ...(hour < 8 ? [] : [{ provider: 'google', eur: 0.05, coveredEur: 0 }]),
      ],
    })),
    days,
    models: [
      {
        provider: 'xai',
        model: 'grok-4.7',
        eur: 88.4,
        calls: 9120,
        failed: 41,
        fallback: 0,
        inputTokens: 21_400_000,
        outputTokens: 610_000,
      },
      {
        provider: 'google',
        model: 'gemini-3.8-flash',
        eur: 6.9,
        calls: 1310,
        failed: 2,
        fallback: 0,
        inputTokens: 3_100_000,
        outputTokens: 120_000,
      },
      {
        provider: 'mistral',
        model: 'mistral-large-4',
        eur: 1.2,
        calls: 64,
        failed: 0,
        fallback: 64,
        inputTokens: 140_000,
        outputTokens: 9_000,
      },
    ],
    uses: [
      { use: 'voice', eur: 52.3, calls: 4300 },
      { use: 'brain', eur: 37.3, calls: 4884 },
      { use: 'sense', eur: 6.9, calls: 1310 },
    ],
    pace: {
      perDayEur: 3.4,
      perDayOver: 7,
      monthEur: 38.9,
      monthCoveredEur: 9.1,
      monthForecastEur: 103.5,
      monthForecastCoveredEur: 64.3,
      month: '2026-11',
    },
    lastCallAt: '2026-11-11T13:29:48.000Z',
    credits: [
      {
        provider: 'mistral',
        mode: 'credits',
        currency: 'USD',
        balanceMinor: 1240,
        countedFrom: '2026-11-08T09:00:00.000Z',
        spentSinceMinor: 3760,
        perDayMinor: 380,
        daysLeft: 3.26,
        runsOutOn: '2026-11-14',
        state: 'low',
        quotaRefusedAt: null,
        entries: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            provider: 'mistral',
            kind: 'topup',
            amountMinor: 5000,
            currency: 'USD',
            at: '2026-11-08T09:00:00.000Z',
          },
        ],
      },
      {
        provider: 'xai',
        mode: 'subscription',
        currency: 'USD',
        balanceMinor: 0,
        countedFrom: '2026-11-09T18:00:00.000Z',
        spentSinceMinor: 812,
        perDayMinor: 270,
        daysLeft: null,
        runsOutOn: null,
        state: 'included',
        quotaRefusedAt: null,
        entries: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            provider: 'xai',
            kind: 'subscription',
            amountMinor: 0,
            currency: 'USD',
            at: '2026-11-09T18:00:00.000Z',
          },
        ],
      },
    ],
    voice: {
      used: 2_480,
      limit: 10_000,
      resetsAt: '2026-12-01T00:00:00.000Z',
      plan: 'free',
      readAt: '2026-11-11T13:21:00.000Z',
    },
    forecast: forecastFixture(),
    ...overrides,
  });
}

const range = (low: number, realistic: number, high: number) => ({ low, realistic, high });

/** An invented forecast (ADR 0091 § 8): one creator's month at about twenty conversations a day. */
export function forecastFixture(overrides: Partial<AiForecast> = {}): AiForecast {
  return AiForecastSchema.parse({
    basisDays: 14,
    thisMonth: { month: '2026-11', monthSoFarEur: 171.4, ...range(254.2, 290.6, 318.9) },
    nextMonth: { month: '2026-12', ...range(258.1, 334.7, 392.9) },
    lines: [
      {
        line: 'chatting',
        monthSoFarEur: 140.2,
        perDay: range(6.9, 9.2, 10.8),
        thisMonth: range(202.3, 222.1, 237.4),
        nextMonth: range(213.9, 285.1, 334.8),
      },
      {
        line: 'playground',
        monthSoFarEur: 14.8,
        perDay: range(0.4, 0.7, 0.9),
        thisMonth: range(18.4, 21.1, 22.9),
        nextMonth: range(12.4, 21.7, 27.9),
      },
      {
        line: 'instagram',
        monthSoFarEur: 7.1,
        perDay: range(0.3, 0.4, 0.5),
        thisMonth: range(9.8, 10.7, 11.6),
        nextMonth: range(9.3, 12.4, 15.5),
      },
      {
        line: 'telegram',
        monthSoFarEur: 5.2,
        perDay: range(0.25, 0.3, 0.35),
        thisMonth: range(7.5, 7.9, 8.4),
        nextMonth: range(7.8, 9.3, 10.9),
      },
      {
        line: 'media',
        monthSoFarEur: 4.1,
        perDay: range(0.1, 0.2, 0.3),
        thisMonth: range(5.0, 5.9, 6.8),
        nextMonth: range(3.1, 6.2, 9.3),
      },
    ],
    creators: [
      {
        creatorId: '00000000-0000-4000-8000-00000000000a',
        name: 'Créatrice A',
        monthSoFarEur: 141.9,
        thisMonth: range(210.1, 236.8, 254.2),
        nextMonth: range(220.5, 289.4, 340.1),
        conversationsPerDay: 21.4,
        salesMonthSoFarEur: 4_870,
        aiShareSoFar: 0.029,
        salesNextMonthEur: 9_300,
      },
      {
        creatorId: '00000000-0000-4000-8000-00000000000b',
        name: 'Créatrice B',
        monthSoFarEur: 14.7,
        thisMonth: range(18.0, 21.0, 24.4),
        nextMonth: range(20.1, 22.9, 26.5),
        conversationsPerDay: 2.3,
        salesMonthSoFarEur: null,
        aiShareSoFar: null,
        salesNextMonthEur: null,
      },
    ],
    conversationsPerDay: 23.7,
    eurPerConversationDay: 0.38,
    moreTraffic: { thisMonthEur: 331.6, nextMonthEur: 475.8 },
    cap: { capEur: 25, reachedAtRealistic: false, reachedWithMoreTraffic: false, nextMonthMaxEur: 775 },
    sales: {
      monthSoFarEur: 4_870,
      aiShareSoFar: 0.035,
      thisMonthEur: 7_820,
      nextMonthEur: 9_300,
      aiShare: 0.036,
    },
    ...overrides,
  });
}
