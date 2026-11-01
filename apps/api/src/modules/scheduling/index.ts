import type { CreatorId, PayPeriod } from '@nirvana/contracts';
import type { Database, Transaction } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createLeaveService } from './application/leaves';
import { makeShifts } from './application/make-shifts';
import { createPayRulesService } from './application/pay-rules';
import { createShiftReportService } from './application/reports';
import { createSchedulingService } from './application/scheduling';
import { createSwapService } from './application/swaps';
import type { CreatorDirectory, JobLogger, OnShift } from './domain/ports';
import { createDrizzleColleagueReads } from './infra/colleague-reads';
import { createDrizzleLeaveStore } from './infra/leave-store';
import {
  reportsAwaitingReviewScoped,
  validatedReportsScoped,
  validatedReportsUnscoped,
  type CreatorReportsForPay,
  type EnqueuePayRecalculation,
  type ValidatedReportForPay,
} from './infra/pay-reads';
import { createDrizzlePayRulesStore } from './infra/pay-rules-store';
import { createDrizzlePlanningAdmin, createDrizzlePlanningStore } from './infra/planning-store';
import { createDrizzleShiftReportStore } from './infra/report-store';
import { createSchedulingRoutes, type RequireRole } from './infra/routes';
import { agencyTimeZone } from './infra/rows';
import { createDrizzleSwapStore } from './infra/swap-store';

/** Public entry point of the `scheduling` module (EQ-02, ADR 0002). Other modules import this file only. */
export interface SchedulingModule {
  readonly name: 'scheduling';
  /**
   * Mounted under `/v1` by the server: `/scheduling/…` (contracts `scheduling.ts` and `shift-reports.ts`), and
   * `/team/pay-rules` (contract `pay-rules.ts`): the reports read an account's rules in their own transaction.
   */
  routes(requireRole: RequireRole): FastifyPluginAsyncZod;
  /**
   * `onShift` (contract `scheduling.ts`): who is on shift on the creator's accounts at `at`, without the margin, read
   * from the database at each call. For the routing of a « sale » handover (EQ-13), which never goes to a chatter who
   * is only in their margin.
   */
  onShift(creatorId: CreatorId, at: Date): Promise<OnShift[]>;
  /**
   * What pay reads of the planning (EQ-04), in pay's own transaction, given by the composition root: the validated
   * reports up to a period, each with its account's rules for the period it was made in, on every creator (pay's job,
   * admin connection) or creator by creator as the validating member reads them (ADR 0032), the reports still waiting
   * for review, and the agency's zone the periods follow. A validated report enqueues `payroll.recalculate`.
   */
  readonly pay: {
    readonly validatedReportsUnscoped: (tx: Transaction, upTo: PayPeriod) => Promise<ValidatedReportForPay[]>;
    readonly validatedReportsScoped: (
      tx: Transaction,
      creatorIds: readonly string[],
      upTo: PayPeriod,
    ) => Promise<CreatorReportsForPay[]>;
    readonly reportsAwaitingReviewScoped: (
      tx: Transaction,
      creatorIds: readonly string[],
      after: PayPeriod | null,
      upTo: PayPeriod,
    ) => Promise<number>;
    readonly agencyTimeZone: (tx: Transaction) => Promise<string>;
  };
  readonly jobs: {
    /**
     * `scheduling.make_shifts`: the shifts every running template makes ahead; how many were new. A template that
     * fails is logged (`warn`) and tried again next hour, the others are made.
     */
    readonly makeShifts: (logger: JobLogger) => Promise<number>;
    /**
     * `scheduling.lapse_swaps` (ADR 0031): the proposals whose shift started, was cancelled, or changed hands or
     * hours lapse; how many. Enqueued after each acceptance and revert, and every quarter of an hour.
     */
    readonly lapseSwaps: () => Promise<number>;
  };
}

export interface SchedulingDeps {
  /** Application role: the planning's policies run through `withMember` and `withTenantMember`. */
  readonly db: Database;
  /**
   * Admin role, for what crosses creators only: a member's own shifts on every creator (Aujourd'hui), the creator of
   * a shift, template, swap, report or account before entering her, the shift in the way of a conflict, a colleague's name, colour and
   * shifts once the policies let the reader see them (ADR 0031), and the jobs.
   */
  readonly adminDb: Database;
  /** The creators that exist, with their names (the `persona` module's directory). */
  readonly creators: CreatorDirectory;
  /** Pay's `payroll.recalculate` for a period, which a validated report enqueues (the `payroll` module's, EQ-04). */
  readonly enqueuePayRecalculation: EnqueuePayRecalculation;
  readonly now?: () => Date;
}

export function createSchedulingModule(deps: SchedulingDeps): SchedulingModule {
  const now = deps.now ?? (() => new Date());
  const admin = createDrizzlePlanningAdmin(deps.adminDb);
  const colleagues = createDrizzleColleagueReads(deps.adminDb);
  const services = {
    scheduling: createSchedulingService(
      createDrizzlePlanningStore(deps.db, deps.adminDb),
      admin,
      deps.creators,
      now,
    ),
    leaves: createLeaveService(
      createDrizzleLeaveStore(deps.db),
      async () => (await deps.creators.list()).map((creator) => creator.id),
      now,
    ),
    swaps: createSwapService(
      createDrizzleSwapStore(deps.db, deps.adminDb, colleagues),
      colleagues,
      deps.creators,
      now,
    ),
    reports: createShiftReportService(
      createDrizzleShiftReportStore(deps.db, deps.adminDb, deps.enqueuePayRecalculation),
      deps.creators,
      now,
    ),
    payRules: createPayRulesService(createDrizzlePayRulesStore(deps.db, deps.adminDb), deps.creators, now),
  };
  return {
    name: 'scheduling',
    onShift: (creatorId, at) => admin.onShiftUnscoped(creatorId, at),
    pay: { validatedReportsUnscoped, validatedReportsScoped, reportsAwaitingReviewScoped, agencyTimeZone },
    routes: (requireRole) => createSchedulingRoutes(services, requireRole),
    jobs: {
      makeShifts: (logger) => makeShifts(admin, logger, now()),
      lapseSwaps: () => colleagues.lapseSwapsUnscoped(now()),
    },
  };
}
