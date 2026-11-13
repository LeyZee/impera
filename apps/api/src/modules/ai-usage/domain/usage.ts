import {
  AI_CREDIT_CRITICAL_DAYS,
  AI_CREDIT_LOW_DAYS,
  AI_USAGE_DAYS,
  AiCreditProviderSchema,
  AiUsageProviderSchema,
  AiUsageUseSchema,
  type AiCreditCurrency,
  type AiCreditEntry,
  type AiCreditProvider,
  type AiCredits,
  type AiCreditState,
  type AiUsage,
  type AiUsageCapState,
  type AiUsageModel,
  type AiUsageProvider,
  type AiUsageProviderSpend,
  type AiUsageUse,
} from '@impera/contracts';

/**
 * The journal of calls summed by local day, hour, provider, model and use (ADR 0091 § 1). One row per group; the
 * reader has already counted a call billed without a known cost at the gateway's estimate, as the cap does.
 */
export interface UsageRow {
  /** The cap's day, YYYY-MM-DD in its time zone. */
  readonly day: string;
  readonly hour: number;
  readonly provider: AiUsageProvider;
  readonly model: string;
  readonly use: AiUsageUse;
  readonly usd: number;
  readonly calls: number;
  readonly failed: number;
  readonly fallback: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Today against the cap, as the gateway counts it (`health().budget`): the figure that stops the agent. */
export interface CapReading {
  readonly spentEur: number;
  readonly capEur: number;
  readonly alertAtEur: number;
}

export interface UsageInput {
  readonly rows: readonly UsageRow[];
  readonly cap: CapReading;
  /** Today in the cap's time zone, YYYY-MM-DD, and the hour it is there (0 to 23). */
  readonly today: string;
  readonly hour: number;
  /** The first day any call was journaled, in the same zone; null when there is none. */
  readonly firstDay: string | null;
  readonly lastCallAt: Date | null;
  readonly readAt: Date;
  readonly timeZone: string;
  readonly usdPerEur: number;
  /** Every line of the credits ledger. */
  readonly entries: readonly AiCreditEntry[];
  /** What each provider's calls cost (USD) after its `countFrom`, read by the application once it knows it. */
  readonly spentSinceUsd: Readonly<Partial<Record<AiCreditProvider, number>>>;
  /** Each provider's first refusal for lack of credits or quota since it last answered (`UsageReader.quotaRefusedAt`). */
  readonly quotaRefusedAt: Readonly<Partial<Record<AiCreditProvider, Date | null>>>;
}

/** Full days the average spend is taken over, at most. */
const PACE_DAYS = 7;

const DAY_MS = 86_400_000;

/** `day` moved by `by` calendar days; plain date arithmetic, never a time zone. */
export function addDays(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
}

/** Days in the month of `day` (YYYY-MM-DD). */
function daysInMonth(day: string): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The cap's state for a spend, as the gateway decides it (`budgetStatus`). */
export function capState(cap: CapReading): AiUsageCapState {
  if (cap.spentEur >= cap.capEur) return 'reached';
  return cap.spentEur >= cap.alertAtEur ? 'alert' : 'ok';
}

const PROVIDER_ORDER = AiUsageProviderSchema.options;
const USE_ORDER = AiUsageUseSchema.options;

function byProvider(rows: readonly UsageRow[], usdPerEur: number): AiUsageProviderSpend[] {
  return PROVIDER_ORDER.flatMap((provider) => {
    const usd = rows.filter((r) => r.provider === provider).reduce((sum, r) => sum + r.usd, 0);
    return usd > 0 ? [{ provider, eur: usd / usdPerEur }] : [];
  });
}

/** Lines a credits card shows, latest first. */
const CREDIT_ENTRIES_SHOWN = 10;

const byTime = (a: AiCreditEntry, b: AiCreditEntry): number => Date.parse(a.at) - Date.parse(b.at);

/**
 * The line a provider's count starts from (ADR 0091 § 3): its latest subscription line when that is its latest line
 * (§ 6, nothing to count, only what was spent since); otherwise, among the lines after its latest subscription line,
 * the latest balance reading, or the first top-up when there is none. Null without any line.
 */
export function countFrom(entries: readonly AiCreditEntry[]): AiCreditEntry | null {
  const sorted = [...entries].sort(byTime);
  const last = sorted.at(-1);
  if (last === undefined || last.kind === 'subscription') return last ?? null;
  const subscribedAt = sorted.filter((e) => e.kind === 'subscription').at(-1)?.at;
  const counted =
    subscribedAt === undefined ? sorted : sorted.filter((e) => Date.parse(e.at) > Date.parse(subscribedAt));
  return counted.filter((e) => e.kind === 'balance').at(-1) ?? counted[0] ?? null;
}

/** An amount of cents in another currency, at the cap's rate (dollars per euro). */
function convert(minor: number, from: AiCreditCurrency, to: AiCreditCurrency, usdPerEur: number): number {
  if (from === to) return minor;
  return from === 'EUR' ? minor * usdPerEur : minor / usdPerEur;
}

/** The state of a card: empty at 0, red under two days, amber under five (« ok conso-ia »). */
export function creditState(balanceMinor: number, daysLeft: number | null): AiCreditState {
  if (balanceMinor <= 0) return 'empty';
  if (daysLeft === null) return 'unknown_pace';
  if (daysLeft < AI_CREDIT_CRITICAL_DAYS) return 'critical';
  return daysLeft < AI_CREDIT_LOW_DAYS ? 'low' : 'ok';
}

interface CreditsInput {
  readonly provider: AiCreditProvider;
  readonly quotaRefusedAt: Date | null;
  readonly entries: readonly AiCreditEntry[];
  readonly spentSinceUsd: number;
  /** This provider's average a day in USD, null without a pace. */
  readonly perDayUsd: number | null;
  readonly today: string;
  readonly usdPerEur: number;
}

/** One provider's card: what is left, at what pace, until when. Null without any line. */
export function creditsOf(input: CreditsInput): AiCredits | null {
  const from = countFrom(input.entries);
  const latest = [...input.entries].sort(byTime).at(-1);
  if (from === null || latest === undefined) return null;
  const { currency } = latest;
  const { usdPerEur } = input;
  const quotaRefusedAt = input.quotaRefusedAt?.toISOString() ?? null;
  const entries = [...input.entries].sort(byTime).reverse().slice(0, CREDIT_ENTRIES_SHOWN);
  const toMinor = (usd: number): number => Math.round(convert(usd * 100, 'USD', currency, usdPerEur));
  if (from.kind === 'subscription')
    return {
      provider: input.provider,
      mode: 'subscription',
      currency,
      balanceMinor: 0,
      countedFrom: from.at,
      spentSinceMinor: toMinor(input.spentSinceUsd),
      perDayMinor: input.perDayUsd === null ? null : toMinor(input.perDayUsd),
      daysLeft: null,
      runsOutOn: null,
      state: quotaRefusedAt === null ? 'included' : 'quota_reached',
      quotaRefusedAt,
      entries,
    };
  const fromAt = Date.parse(from.at);
  // A balance reading counts at its instant; the top-ups after it add up. Counted from a first top-up, it is one.
  const added = input.entries
    .filter(
      (e) =>
        e.kind === 'topup' &&
        (from.kind === 'balance' ? Date.parse(e.at) > fromAt : Date.parse(e.at) >= fromAt),
    )
    .reduce((total, e) => total + convert(e.amountMinor, e.currency, currency, usdPerEur), 0);
  const base = from.kind === 'balance' ? convert(from.amountMinor, from.currency, currency, usdPerEur) : 0;
  const spentSinceMinor = Math.round(convert(input.spentSinceUsd * 100, 'USD', currency, usdPerEur));
  const balanceMinor = Math.round(base + added) - spentSinceMinor;
  const perDayMinor =
    input.perDayUsd === null ? null : Math.round(convert(input.perDayUsd * 100, 'USD', currency, usdPerEur));
  const daysLeft = perDayMinor === null || perDayMinor === 0 ? null : Math.max(0, balanceMinor) / perDayMinor;
  return {
    provider: input.provider,
    mode: 'credits',
    currency,
    balanceMinor,
    countedFrom: new Date(fromAt).toISOString(),
    spentSinceMinor,
    perDayMinor,
    daysLeft,
    runsOutOn: daysLeft === null ? null : addDays(input.today, Math.floor(daysLeft)),
    // Nothing spent over the pace's days: the balance does not go down, nothing to recharge.
    state: perDayMinor === 0 && balanceMinor > 0 ? 'ok' : creditState(balanceMinor, daysLeft),
    quotaRefusedAt,
    entries,
  };
}

const sum = (rows: readonly UsageRow[], pick: (row: UsageRow) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0);

/**
 * Everything the screen shows, from the summed journal (ADR 0091 § 2): today against the cap, today hour by hour, the
 * last 30 days, the models and the uses over them, and the pace. Pure: the clock and the zone are given.
 */
export function aiUsage(input: UsageInput): AiUsage {
  const { rows, usdPerEur, today } = input;
  const first = addDays(today, -(AI_USAGE_DAYS - 1));
  const inWindow = rows.filter((r) => r.day >= first && r.day <= today);
  const eurOf = (subset: readonly UsageRow[]): number => sum(subset, (r) => r.usd) / usdPerEur;

  const days = Array.from({ length: AI_USAGE_DAYS }, (_, i) => {
    const day = addDays(first, i);
    const ofDay = inWindow.filter((r) => r.day === day);
    return {
      day,
      eur: eurOf(ofDay),
      calls: sum(ofDay, (r) => r.calls),
      providers: byProvider(ofDay, usdPerEur),
    };
  });

  const ofToday = inWindow.filter((r) => r.day === today);
  const hours = Array.from({ length: input.hour + 1 }, (_, hour) => {
    const ofHour = ofToday.filter((r) => r.hour === hour);
    return {
      hour,
      eur: eurOf(ofHour),
      calls: sum(ofHour, (r) => r.calls),
      providers: byProvider(ofHour, usdPerEur),
    };
  });

  const models = new Map<string, AiUsageModel>();
  for (const row of inWindow) {
    const key = `${row.provider} ${row.model}`;
    const seen = models.get(key);
    models.set(key, {
      provider: row.provider,
      model: row.model,
      eur: (seen?.eur ?? 0) + row.usd / usdPerEur,
      calls: (seen?.calls ?? 0) + row.calls,
      failed: (seen?.failed ?? 0) + row.failed,
      fallback: (seen?.fallback ?? 0) + row.fallback,
      inputTokens: (seen?.inputTokens ?? 0) + row.inputTokens,
      outputTokens: (seen?.outputTokens ?? 0) + row.outputTokens,
    });
  }

  const uses = USE_ORDER.flatMap((use) => {
    const ofUse = inWindow.filter((r) => r.use === use);
    const calls = sum(ofUse, (r) => r.calls);
    return calls === 0 ? [] : [{ use, eur: eurOf(ofUse), calls }];
  }).sort((a, b) => b.eur - a.eur);

  // The full days before today, from the first day with a call: a new install is not averaged over empty days.
  const paceFrom =
    input.firstDay === null || input.firstDay > addDays(today, -PACE_DAYS)
      ? (input.firstDay ?? today)
      : addDays(today, -PACE_DAYS);
  const perDayOver = Math.max(
    0,
    Math.min(PACE_DAYS, Math.round((Date.parse(today) - Date.parse(paceFrom)) / DAY_MS)),
  );
  const paceRows = inWindow.filter((r) => r.day >= paceFrom && r.day < today);
  const perDayEur = perDayOver === 0 ? null : eurOf(paceRows) / perDayOver;
  const credits = AiCreditProviderSchema.options.flatMap((provider) => {
    const card = creditsOf({
      provider,
      quotaRefusedAt: input.quotaRefusedAt[provider] ?? null,
      entries: input.entries.filter((e) => e.provider === provider),
      spentSinceUsd: input.spentSinceUsd[provider] ?? 0,
      perDayUsd:
        perDayOver === 0
          ? null
          : sum(
              paceRows.filter((r) => r.provider === provider),
              (r) => r.usd,
            ) / perDayOver,
      today,
      usdPerEur,
    });
    return card === null ? [] : [card];
  });

  const month = today.slice(0, 7);
  const monthEur = eurOf(inWindow.filter((r) => r.day.startsWith(month)));
  const daysLeft = daysInMonth(today) - Number(today.slice(8, 10));

  return {
    readAt: input.readAt.toISOString(),
    timeZone: input.timeZone,
    usdPerEur,
    today: {
      day: today,
      eur: input.cap.spentEur,
      capEur: input.cap.capEur,
      alertAtEur: input.cap.alertAtEur,
      state: capState(input.cap),
      calls: sum(ofToday, (r) => r.calls),
      failed: sum(ofToday, (r) => r.failed),
    },
    hours,
    days,
    models: [...models.values()].sort((a, b) => b.eur - a.eur || b.calls - a.calls),
    uses,
    pace: {
      perDayEur,
      perDayOver,
      monthEur,
      monthForecastEur: perDayEur === null ? null : monthEur + perDayEur * daysLeft,
      month,
    },
    lastCallAt: input.lastCallAt?.toISOString() ?? null,
    credits,
  };
}
