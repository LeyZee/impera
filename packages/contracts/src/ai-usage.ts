import { z } from 'zod';

/**
 * `GET /v1/settings/ai-usage` (ADR 0091): what the AI models cost the agency, read in the journal of calls
 * (`llm_calls`), for the owner alone. Never a prompt, an answer, a fan nor a conversation: sums only.
 *
 * Money in euros (decimal, a call costs a fraction of a cent), converted from the providers' dollars at the daily
 * cap's rate (`usdPerEur`, kept low on purpose so the spend is never under-told). Days are the cap's: midnight to
 * midnight in `timeZone` (Europe/Paris).
 */

/** The LLM providers a call is journaled under (`llm_calls.provider`); ElevenLabs bills voice notes elsewhere. */
export const AiUsageProviderSchema = z.enum(['xai', 'mistral', 'google', 'venice']);
export type AiUsageProvider = z.infer<typeof AiUsageProviderSchema>;

/**
 * What the money went to, the way the screen names it: the four roles of the gateway (ADR 0009), and the trend
 * watch apart (ADR 0060 § 7), whatever role it used.
 */
export const AiUsageUseSchema = z.enum(['voice', 'brain', 'sense', 'judge', 'trend_watch']);
export type AiUsageUse = z.infer<typeof AiUsageUseSchema>;

const eur = z.number().nonnegative();
const count = z.number().int().nonnegative();
const day = z.iso.date();

/** One provider's share of a day or an hour. */
export const AiUsageProviderSpendSchema = z.strictObject({
  provider: AiUsageProviderSchema,
  eur,
  /** The part of `eur` the owner's subscription paid (ADR 0091 § 6), 0 on credits. */
  coveredEur: eur,
});
export type AiUsageProviderSpend = z.infer<typeof AiUsageProviderSpendSchema>;

export const AiUsageDaySchema = z.strictObject({
  day,
  eur,
  /** The part of `eur` the owner's subscription paid (ADR 0091 § 6, « ok 0091 chiffres »). */
  coveredEur: eur,
  calls: count,
  /** Every provider that cost something that day, in `AiUsageProviderSchema`'s order. */
  providers: z.array(AiUsageProviderSpendSchema),
});
export type AiUsageDay = z.infer<typeof AiUsageDaySchema>;

export const AiUsageHourSchema = z.strictObject({
  /** 0 to 23, the hour of the cap's day; the hours not come yet are left out. */
  hour: z.number().int().min(0).max(23),
  eur,
  coveredEur: eur,
  calls: count,
  providers: z.array(AiUsageProviderSpendSchema),
});
export type AiUsageHour = z.infer<typeof AiUsageHourSchema>;

export const AiUsageModelSchema = z.strictObject({
  provider: AiUsageProviderSchema,
  model: z.string().min(1),
  eur,
  calls: count,
  /** Calls that came back with an error (time-out, refusal, invalid answer…), billed or not. */
  failed: count,
  /** Calls made on this model because the main one did not answer. */
  fallback: count,
  inputTokens: count,
  outputTokens: count,
});
export type AiUsageModel = z.infer<typeof AiUsageModelSchema>;

export const AiUsageUseSpendSchema = z.strictObject({ use: AiUsageUseSchema, eur, calls: count });
export type AiUsageUseSpend = z.infer<typeof AiUsageUseSpendSchema>;

/*
 * The credits ledger (ADR 0091 § 3): the providers bill in advance and none of them gives its balance to a normal key,
 * so the owner writes down each top-up, or the balance read in the provider's console, and the server counts down
 * with the cost of every call journaled since.
 */

/**
 * A top-up adds to what was there; a balance reading replaces it from that instant. `subscription` (ADR 0091 § 6,
 * « ok 0091 abonnement »): from that instant the provider is paid by the owner's subscription, with a usage quota and
 * no balance; a top-up or a balance reading after it goes back to counting credits.
 */
export const AiCreditEntryKindSchema = z.enum(['topup', 'balance', 'subscription']);
export type AiCreditEntryKind = z.infer<typeof AiCreditEntryKindSchema>;

/** The currency the provider bills its credits in, as its console shows them. */
export const AiCreditCurrencySchema = z.enum(['USD', 'EUR']);
export type AiCreditCurrency = z.infer<typeof AiCreditCurrencySchema>;

/** Credits bought for the paid providers only: Venice, the last fallback, is not followed. */
export const AiCreditProviderSchema = z.enum(['xai', 'mistral', 'google']);
export type AiCreditProvider = z.infer<typeof AiCreditProviderSchema>;

/** At most this much in one line (cents): a typo of three zeros is refused, not counted. */
export const AI_CREDIT_MAX_MINOR = 1_000_000;

export const AiCreditEntrySchema = z.strictObject({
  id: z.uuid(),
  provider: AiCreditProviderSchema,
  kind: AiCreditEntryKindSchema,
  /** In cents of `currency`; a top-up is above 0, a balance reading may be 0, a subscription line is 0. */
  amountMinor: z.number().int().min(0).max(AI_CREDIT_MAX_MINOR),
  currency: AiCreditCurrencySchema,
  /** When the money arrived, or when the balance was read. */
  at: z.iso.datetime({ offset: true }),
});
export type AiCreditEntry = z.infer<typeof AiCreditEntrySchema>;

/** `POST /v1/settings/ai-usage/credits`: the id comes from the screen, the same line sent twice is kept once. */
export const AddAiCreditEntryBodySchema = AiCreditEntrySchema.omit({ at: true })
  .extend({
    /** Absent: now. Never later than the server's clock (5 minutes of drift allowed). */
    at: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((body) => body.kind !== 'topup' || body.amountMinor > 0, {
    message: 'Une recharge est d’au moins un centime.',
    path: ['amountMinor'],
  })
  .refine((body) => body.kind !== 'subscription' || body.amountMinor === 0, {
    message: 'L’abonnement ne porte pas de montant.',
    path: ['amountMinor'],
  });
export type AddAiCreditEntryBody = z.infer<typeof AddAiCreditEntryBodySchema>;

/**
 * When to recharge (Charles, « ok conso-ia », 11/11): amber under five days of credits at the pace of the last full
 * days, red under two, and a Telegram alert the first time each is crossed.
 */
export const AI_CREDIT_LOW_DAYS = 5;
export const AI_CREDIT_CRITICAL_DAYS = 2;

/**
 * A credits card: `ok`, `low`, `critical`, `empty`, `unknown_pace`. A subscription card (ADR 0091 § 6): `included`
 * while the provider answers, `quota_reached` once it refused for lack of quota and has not answered since.
 */
export const AiCreditStateSchema = z.enum([
  'ok',
  'low',
  'critical',
  'empty',
  'unknown_pace',
  'included',
  'quota_reached',
]);
export type AiCreditState = z.infer<typeof AiCreditStateSchema>;

/** `credits`: counted down from the ledger. `subscription`: paid by the owner's subscription, nothing to count. */
export const AiCreditModeSchema = z.enum(['credits', 'subscription']);
export type AiCreditMode = z.infer<typeof AiCreditModeSchema>;

export const AiCreditsSchema = z.strictObject({
  provider: AiCreditProviderSchema,
  mode: AiCreditModeSchema,
  /** The currency of its latest line: every figure of the card is in it. */
  currency: AiCreditCurrencySchema,
  /** Estimated credits left now, in cents; below 0 when the calls went past what was written down. 0 on a subscription. */
  balanceMinor: z.number().int(),
  /**
   * The line the count starts from (the latest balance reading, or the first top-up; the subscription line on a
   * subscription), and what was spent since: on a subscription, what the calls would have cost, for information.
   */
  countedFrom: z.iso.datetime({ offset: true }),
  spentSinceMinor: z.number().int().nonnegative(),
  /** This provider's average a day (cents), as `pace.perDayEur` is taken; null before a first full day. */
  perDayMinor: z.number().int().nonnegative().nullable(),
  /** Days of credits left at that pace; null without a pace or a spend, and always on a subscription. */
  daysLeft: z.number().nonnegative().nullable(),
  /** The day they run out at that pace, in the cap's zone. */
  runsOutOn: z.iso.date().nullable(),
  state: AiCreditStateSchema,
  /**
   * The first refusal for lack of credits or quota since this provider last answered; null while it answers. The agent
   * goes on with its fallback model meanwhile.
   */
  quotaRefusedAt: z.iso.datetime({ offset: true }).nullable(),
  /** The latest lines first, at most ten. */
  entries: z.array(AiCreditEntrySchema),
});
export type AiCredits = z.infer<typeof AiCreditsSchema>;

export const AiUsageCapStateSchema = z.enum(['ok', 'alert', 'reached']);
export type AiUsageCapState = z.infer<typeof AiUsageCapStateSchema>;

export const AiUsageSchema = z.strictObject({
  /** When the server read the journal: the screen says how fresh the figures are. */
  readAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1),
  usdPerEur: z.number().positive(),
  /** Today against the daily cap, as the gateway counts it (the figure that stops the agent). */
  today: z.strictObject({
    day,
    eur,
    /** The part of `eur` the subscription paid; the cap counts it all the same. */
    coveredEur: eur,
    capEur: z.number().positive(),
    alertAtEur: z.number().positive(),
    state: AiUsageCapStateSchema,
    calls: count,
    failed: count,
  }),
  /** Today hour by hour, up to the current hour. */
  hours: z.array(AiUsageHourSchema),
  /** The last `AI_USAGE_DAYS` days, oldest first, today last; a day without a call is there at 0. */
  days: z.array(AiUsageDaySchema),
  /** Over the same days, most expensive first. */
  models: z.array(AiUsageModelSchema),
  uses: z.array(AiUsageUseSpendSchema),
  pace: z.strictObject({
    /**
     * Average spend a day over the up to seven full days before today, from the first day with a call; null before a
     * first full day.
     */
    perDayEur: eur.nullable(),
    /** The full days the average is over (0 to 7). */
    perDayOver: z.number().int().min(0).max(7),
    /** The calendar month so far, today included. */
    monthEur: eur,
    /** The part of `monthEur` the subscription paid. */
    monthCoveredEur: eur,
    /** The month so far, plus the average for each day left after today; null without an average. */
    monthForecastEur: eur.nullable(),
    /**
     * The part of the forecast the subscription would pay: what it paid this month, plus, for each provider on it now,
     * its own average for each day left. Null with the forecast.
     */
    monthForecastCoveredEur: eur.nullable(),
    month: z.string().regex(/^\d{4}-\d{2}$/u),
  }),
  /** The last call journaled, any provider; null when there is none in the window. */
  lastCallAt: z.iso.datetime({ offset: true }).nullable(),
  /** One card per provider with at least one line in the ledger, in `AiCreditProviderSchema`'s order. */
  credits: z.array(AiCreditsSchema),
});
export type AiUsage = z.infer<typeof AiUsageSchema>;

/** Days the screen reads, today included. */
export const AI_USAGE_DAYS = 30;

/**
 * The error codes of the ledger's routes. `ai_credit_in_future_unprocessable`: dated more than 5 minutes ahead of the
 * server's clock. `ai_credit_conflict`: this `id` is already written with other values. `ai_credit_not_found`: no
 * such line to take back.
 */
export const AI_CREDIT_ERROR_CODES = [
  'ai_credit_in_future_unprocessable',
  'ai_credit_conflict',
  'ai_credit_not_found',
] as const;
export type AiCreditErrorCode = (typeof AI_CREDIT_ERROR_CODES)[number];
