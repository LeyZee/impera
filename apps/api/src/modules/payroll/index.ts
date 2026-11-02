import type { ExchangeRate, ForeignCurrency, PayPeriod, UserId } from '@nirvana/contracts';
import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { JobLogger } from '../contractors/pure';

import { createPayrollEntries } from './application/entries';
import { fetchExchangeRates, type RateFetchOutcome } from './application/exchange-rates';
import { createPayrollReads } from './application/periods';
import { createRecalculation, type RecalculationOutcome } from './application/recalculation';
import { createPayrollValidation } from './application/validation';
import type { RateJobSince } from './domain/ports';
import { createEcbSource, type GetLike } from './infra/ecb';
import { createDrizzlePayrollEntryStore, writeContestCorrection } from './infra/entry-store';
import { createDrizzlePayrollJobStore } from './infra/job-store';
import { createLatestRateRead } from './infra/latest-rate';
import type { AfterValidation, ContestCorrectionWrite, PayoutGate } from './infra/ports';
import { createPostgresRateAlerts } from './infra/rate-alerts';
import { createDrizzlePayrollRateStore } from './infra/rate-store';
import { createDrizzlePayrollReadStore } from './infra/read-store';
import { createPayrollRoutes, type RequireRole } from './infra/routes';
import { createDrizzlePayrollRuleStore } from './infra/rule-store';
import type { PayInputReads } from './infra/snapshot';
import { createDrizzlePayrollValidationStore } from './infra/validation-store';

/**
 * Pay's `payroll.recalculate` for a period, in the caller's transaction: the planning enqueues it when it validates a
 * report, through the composition root (EQ-04). One key and one number of attempts for every writer.
 */
export { enqueuePayRecalculation } from './infra/recalculation-queue';

/**
 * What pay asks of the other modules of pay and what it gives them (ADR 0047 § 1): the composition root plugs
 * `invoicing`'s `PayoutGate` and the invoices' and the contractors' `AfterValidation` in, and `invoicing` writes the
 * correction of an upheld contest through `correctContest`.
 */
export type { AfterValidation, ContestCorrectionWrite, PayoutGate } from './infra/ports';
export type { PayoutVerdict } from './domain/ports';
/** Refused to a member on their own pay or document: the owner never decides in their own name (`invoicing` too). */
export { PayrollOwnForbidden } from './domain/errors';
/**
 * How a statement's `counted` column reads, for the invoice store that still reads `commission_statements` directly.
 * It goes when that read goes through a read port of this module (ARC-07).
 */
export { CountedSchema } from './infra/read-store';

/** Public entry point of the `payroll` module (EQ-04, ADR 0002). Other modules import this file only. */
export interface PayrollModule {
  readonly name: 'payroll';
  /** Mounted under `/v1` by the server: `/payroll/…` (contracts `payroll.ts`). */
  routes(requireRole: RequireRole): FastifyPluginAsyncZod;
  /**
   * The newest rate of a currency (ADR 0033), `null` before the first: the last ECB rate known, the one a draft of pay
   * keeps. Read under the reader's member context (`withMember`, policy `team_read`); the composition root gives it to
   * the Dashboard, which ranks its best fans with it and shows only its day.
   */
  readonly latestRate: (userId: UserId, currency: ForeignCurrency) => Promise<ExchangeRate | null>;
  /** The adjustments of an upheld contest's correction, in `invoicing`'s transaction (ADR 0039 § 3). */
  readonly correctContest: ContestCorrectionWrite;
  readonly jobs: {
    /**
     * `payroll.recalculate` (ADR 0032): the drafts of a period, and those of the team's first open period when it is
     * closed. A period that cannot be computed yet (a missing rate) is logged, never guessed.
     */
    readonly recalculate: (period: PayPeriod, logger: JobLogger) => Promise<RecalculationOutcome[]>;
    /** `payroll.recalculate_open`: every open period up to the current one, each hour. */
    readonly recalculateOpen: (logger: JobLogger) => Promise<RecalculationOutcome[]>;
    /**
     * `payroll.fetch_exchange_rates` (ADR 0033): the ECB's last 90 days, each day written once; then
     * `exchange_rate_overdue`, once a day, for a currency without a rate for more than two weekdays (in production,
     * also one that never got a rate).
     */
    readonly fetchExchangeRates: (logger: JobLogger) => Promise<RateFetchOutcome>;
  };
}

export interface PayrollDeps {
  /** Application role: what a member reads runs through `withMember`. */
  readonly db: Database;
  /**
   * Admin role, for the jobs, which read every creator's reports (ADR 0023 § Paie), and for the one check of a closing
   * that the member who validates read every report it counts (ADR 0032).
   */
  readonly adminDb: Database;
  /** What pay reads of the planning, the team and the creators, from their `index.ts`. */
  readonly reads: PayInputReads;
  readonly now?: () => Date;
  /** The ECB is reached through it (ADR 0033); the global `fetch` unless a test gives a fake one. */
  readonly fetch?: GetLike;
  /**
   * Production only (composition root): when the rate job was first scheduled, so that a currency that never got a
   * rate is alerted too (ADR 0033). `null` elsewhere.
   */
  readonly rateJobSince: RateJobSince | null;
  /** Whether a transfer may go, and the open documents of a member who left: `invoicing`'s (ADR 0047 § 1). */
  readonly payouts: PayoutGate;
  /** What a validation or a transfer enqueues for the invoices and the contractors' file (ADR 0047 § 1). */
  readonly afterValidation: AfterValidation;
}

export function createPayrollModule(deps: PayrollDeps): PayrollModule {
  const now = deps.now ?? (() => new Date());
  const jobStore = createDrizzlePayrollJobStore(deps.adminDb, deps.reads, now);
  const reads = createPayrollReads(
    createDrizzlePayrollReadStore(deps.db, deps.adminDb, deps.reads, now, deps.payouts),
    now,
  );
  const validation = createPayrollValidation(
    createDrizzlePayrollValidationStore(
      deps.db,
      deps.adminDb,
      deps.reads,
      now,
      deps.payouts,
      deps.afterValidation,
    ),
    reads,
  );
  const entries = createPayrollEntries(
    createDrizzlePayrollEntryStore(deps.db, deps.reads, now, deps.payouts, deps.afterValidation),
    reads,
  );
  const rules = createDrizzlePayrollRuleStore(deps.db, deps.reads, now);
  const rateJob = {
    source: createEcbSource({ fetch: deps.fetch ?? ((url, init) => fetch(url, init)) }),
    store: createDrizzlePayrollRateStore(deps.adminDb),
    alerts: createPostgresRateAlerts(deps.adminDb),
    since: deps.rateJobSince,
    now,
  };
  return {
    name: 'payroll',
    routes: (requireRole) => createPayrollRoutes(reads, validation, entries, rules, requireRole),
    latestRate: createLatestRateRead(deps.db),
    correctContest: (tx, actor, correction) => writeContestCorrection(tx, deps.reads, now, actor, correction),
    jobs: {
      recalculate: (period, logger) => createRecalculation(jobStore, logger, now).recalculate(period),
      recalculateOpen: (logger) => createRecalculation(jobStore, logger, now).recalculateOpen(),
      fetchExchangeRates: (logger) => fetchExchangeRates(rateJob, logger),
    },
  };
}
