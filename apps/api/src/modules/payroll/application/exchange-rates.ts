import { ExchangeRateSchema, ForeignCurrencySchema, type ForeignCurrency } from '@nirvana/contracts';

import { ECB_SOURCE, ecbDay, eurosPerUnitMicros, isRateOverdue } from '../domain/exchange-rates';
import type {
  JobLogger,
  PayrollRateAlerts,
  PayrollRateStore,
  RateJobSince,
  RateSource,
} from '../domain/ports';

/** What one run of the rate job did, for its log line. */
export interface RateFetchOutcome {
  /** The ECB's days of a currency pay uses. */
  readonly read: number;
  /** Those not written yet: a run that finds nothing new writes nothing. */
  readonly written: number;
  /** The currencies whose `exchange_rate_overdue` this run published. */
  readonly alerted: readonly ForeignCurrency[];
}

export interface RateJobDeps {
  readonly source: RateSource;
  readonly store: PayrollRateStore;
  readonly alerts: PayrollRateAlerts;
  /**
   * Given in production only: a currency that never got a rate is alerted too, counted from the job's first schedule.
   * `null` elsewhere (development, tests), where a database without rates is the normal case and says nothing.
   */
  readonly since: RateJobSince | null;
  readonly now: () => Date;
}

/**
 * `payroll.fetch_exchange_rates` (ADR 0033): the ECB's last 90 days, each day of a currency pay uses written once, in
 * pay's terms. Then, whether the read worked or not (a failed read is just when rates go missing), each currency whose
 * last rate is overdue publishes `exchange_rate_overdue`, once a day. A failure to read then fails the job, and its
 * attempts and the next hour retry; no other source fills in.
 */
export async function fetchExchangeRates(deps: RateJobDeps, logger: JobLogger): Promise<RateFetchOutcome> {
  const read = await writeRates(deps, logger).catch((error: unknown) => ({ failure: error }));
  const alerted = await alertOverdueRates(deps);
  if ('failure' in read) throw read.failure;
  return { ...read, alerted };
}

async function writeRates(
  { source, store, now }: RateJobDeps,
  logger: JobLogger,
): Promise<Omit<RateFetchOutcome, 'alerted'>> {
  const fetchedAt = now().toISOString();
  const rates = (await source.history()).map((rate) =>
    ExchangeRateSchema.parse({
      currency: rate.currency,
      day: rate.day,
      rateMicros: eurosPerUnitMicros(rate.perEuro),
      source: ECB_SOURCE,
      fetchedAt,
    }),
  );
  if (rates.length === 0) throw new Error('The ECB file has no rate of a currency pay uses');
  const { written, differing } = await store.addUnscoped(rates);
  if (differing.length > 0) {
    logger.error(
      { days: differing.map((rate) => `${rate.currency} ${rate.day}`) },
      'payroll: the ECB gives another rate for a day already written, which stays as it is; this repeats each hour until the day leaves the ECB’s 90 days',
    );
  }
  return { read: rates.length, written };
}

/**
 * A currency rings once its last rate is more than two weekdays old. One that never got a rate (the host cut, a file
 * always refused: the job never succeeded) rings in production only, with `lastRateDay: null`, once the job has been
 * scheduled for more than two weekdays: the day of its first schedule counts as a last rate's day would, since the
 * first read that succeeds writes the ECB's 90 days, that one included. Never scheduled here: nothing.
 */
async function alertOverdueRates({ store, alerts, since, now }: RateJobDeps): Promise<ForeignCurrency[]> {
  const day = ecbDay(now());
  const latest = await store.latestDaysUnscoped();
  const alerted: ForeignCurrency[] = [];
  for (const currency of ForeignCurrencySchema.options) {
    const lastRateDay = latest.get(currency) ?? null;
    const from = lastRateDay ?? (since === null ? null : await firstScheduledDay(since));
    if (from === null || !isRateOverdue(from, day)) continue;
    if (await alerts.publishOverdue({ currency, lastRateDay, day })) alerted.push(currency);
  }
  return alerted;
}

async function firstScheduledDay(since: RateJobSince): Promise<string | null> {
  const at = await since();
  return at === null ? null : ecbDay(at);
}
