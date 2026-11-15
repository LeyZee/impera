import { AiUsageSchema, type AiUsage } from '@impera/contracts';

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
      capEur: 20,
      alertAtEur: 16,
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
    ...overrides,
  });
}
