import type {
  CommissionStatementId,
  ExchangeRate,
  ForeignCurrency,
  PayPeriod,
  UserId,
} from '@nirvana/contracts';
import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createPayrollEntries } from './application/entries';
import { fetchExchangeRates, type RateFetchOutcome } from './application/exchange-rates';
import { issueInvoices } from './application/invoicing';
import { createPayrollReads } from './application/periods';
import { createRecalculation, type RecalculationOutcome } from './application/recalculation';
import { createPayrollValidation } from './application/validation';
import type { InvoicingOutcome, JobLogger, RateJobSince } from './domain/ports';
import { createEcbSource, type GetLike } from './infra/ecb';
import { createDrizzlePayrollEntryStore } from './infra/entry-store';
import { createDrizzlePayrollInvoiceStore } from './infra/invoice-store';
import { createDrizzlePayrollJobStore } from './infra/job-store';
import { createLatestRateRead } from './infra/latest-rate';
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
    /**
     * `payroll.issue_invoices` (EQ-06 lot 3, ADR 0036): a validated statement's invoice and the credit notes its period
     * owes, numbered on the contractor's counter; what cannot be issued is said to the owner (`invoice_not_issued`).
     * Replayable: a run issues only what is missing.
     */
    readonly issueInvoices: (
      statementId: CommissionStatementId,
      logger: JobLogger,
    ) => Promise<InvoicingOutcome>;
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
}

export function createPayrollModule(deps: PayrollDeps): PayrollModule {
  const now = deps.now ?? (() => new Date());
  const jobStore = createDrizzlePayrollJobStore(deps.adminDb, deps.reads, now);
  const reads = createPayrollReads(createDrizzlePayrollReadStore(deps.db, deps.reads, now), now);
  const validation = createPayrollValidation(
    createDrizzlePayrollValidationStore(deps.db, deps.adminDb, deps.reads, now),
    reads,
  );
  const entries = createPayrollEntries(createDrizzlePayrollEntryStore(deps.db, deps.reads, now), reads);
  const rules = createDrizzlePayrollRuleStore(deps.db, deps.reads, now);
  const invoiceStore = createDrizzlePayrollInvoiceStore(deps.adminDb, deps.reads, now);
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
    jobs: {
      recalculate: (period, logger) => createRecalculation(jobStore, logger, now).recalculate(period),
      recalculateOpen: (logger) => createRecalculation(jobStore, logger, now).recalculateOpen(),
      fetchExchangeRates: (logger) => fetchExchangeRates(rateJob, logger),
      issueInvoices: (statementId, logger) => issueInvoices(invoiceStore, statementId, logger),
    },
  };
}
