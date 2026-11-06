import { JOB_PAYLOADS } from '@impera/contracts';

import { defineTask } from '../jobs';
import { salesFeedReadsForPay } from '../modules/connectors';
import { enqueuePayoutCertificateLock } from '../modules/contractors';
import { invoicesAfterValidation, payoutGate } from '../modules/invoicing';
import { createPayrollModule, type PayInputReads, type PayrollModule } from '../modules/payroll';
import type { PersonaModule } from '../modules/persona';
import type { SchedulingModule } from '../modules/scheduling';
import type { TeamModule } from '../modules/team';

import type { ContractorJob } from './contractors';
import type { InvoicingJob } from './invoicing';
import type { JobWithTask, Routes, Shared, TasksNamed } from './shared';

export interface WiredPayroll {
  readonly module: PayrollModule;
  readonly tasks: TasksNamed<
    Exclude<Extract<JobWithTask, `payroll.${string}`>, ContractorJob | InvoicingJob>
  >;
  readonly routes: readonly Routes[];
}

/**
 * What pay reads of the other modules, in its own transaction, through their `index.ts` (EQ-04, CRM-03): the
 * planning's reports, shifts and accounts' rules, the team's members and rates, the creators, and the sales feed's
 * lines. Tests take it to build a pay module that reads less, as a validator who may not read everything would.
 */
export function payInputReadsOf(modules: {
  readonly persona: PersonaModule;
  readonly scheduling: SchedulingModule;
  readonly team: TeamModule;
}): PayInputReads {
  const { scheduling, team, persona } = modules;
  return {
    validatedReportsUnscoped: scheduling.pay.validatedReportsUnscoped,
    validatedReportsScoped: scheduling.pay.validatedReportsScoped,
    reportsAwaitingReviewScoped: scheduling.pay.reportsAwaitingReviewScoped,
    agencyTimeZone: scheduling.pay.agencyTimeZone,
    members: team.pay.members,
    creatorIds: async () => (await persona.creators.list('all')).map((creator) => creator.id),
    sales: {
      accountSources: scheduling.pay.accountSources,
      shifts: scheduling.pay.shifts,
      accessMarginMinutes: scheduling.pay.accessMarginMinutes,
      ...salesFeedReadsForPay,
    },
  };
}

/**
 * Pay reads the planning's reports and shifts, the team's rates and the sales feed's lines in its own transaction,
 * through their `index.ts` (EQ-04, CRM-03). It
 * asks the invoices whether a transfer may go, and enqueues their jobs and the contractors' certificate lock, through
 * the ports plugged here (ADR 0047 § 1): pay never imports `invoicing`.
 */
export function wirePayroll(
  shared: Shared,
  deps: {
    readonly persona: PersonaModule;
    readonly scheduling: SchedulingModule;
    readonly team: TeamModule;
    /** When the rate job was first scheduled, in production only (ADR 0033): `composition-root.ts`. */
    readonly rateJobSince: (() => Promise<Date | null>) | null;
    /** Tests set pay's clock here, the one `wireInvoicing` gets too; the system's otherwise. */
    readonly now?: () => Date;
  },
): WiredPayroll {
  const { db, adminDb, logger, requireRole } = shared;
  const { scheduling, team, persona } = deps;
  const module = createPayrollModule({
    db,
    adminDb,
    reads: payInputReadsOf({ scheduling, team, persona }),
    shiftFacts: scheduling.pay.shiftFacts,
    rateJobSince: deps.rateJobSince,
    payouts: payoutGate,
    afterValidation: { ...invoicesAfterValidation, lockPayoutCertificate: enqueuePayoutCertificateLock },
    ...(deps.now !== undefined && { now: deps.now }),
  });
  return {
    module,
    tasks: {
      'payroll.recalculate': defineTask(
        'payroll.recalculate',
        JOB_PAYLOADS['payroll.recalculate'],
        logger,
        async (payload, context) => {
          context.logger.info(
            { outcomes: await module.jobs.recalculate(payload.period, context.logger) },
            'payroll: drafts computed',
          );
        },
      ),
      'payroll.recalculate_open': defineTask(
        'payroll.recalculate_open',
        JOB_PAYLOADS['payroll.recalculate_open'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { outcomes: await module.jobs.recalculateOpen(context.logger) },
            'payroll: open periods computed',
          );
        },
      ),
      'payroll.fetch_exchange_rates': defineTask(
        'payroll.fetch_exchange_rates',
        JOB_PAYLOADS['payroll.fetch_exchange_rates'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { outcome: await module.jobs.fetchExchangeRates(context.logger) },
            'payroll: exchange rates read',
          );
        },
      ),
    },
    routes: [module.routes(requireRole)],
  };
}
