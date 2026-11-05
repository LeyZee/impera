import type { CreatorId, PayPeriod, PlatformAccountId } from '@impera/contracts';
import type { Database, Transaction } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createAgencyRatesService } from './application/agency-rates';
import { createCalendarService } from './application/calendar';
import { createCalendarLinkService } from './application/calendar-feed';
import { createShiftFeedbackService } from './application/feedback';
import { createLeaveService } from './application/leaves';
import { makeShifts } from './application/make-shifts';
import { createPayRulesService } from './application/pay-rules';
import { createShiftReportService } from './application/reports';
import { createSchedulingService } from './application/scheduling';
import { createSwapService } from './application/swaps';
import type { CreatorAgendaFeed, CreatorDirectory, JobLogger, OnShift } from './domain/ports';
import { createDrizzleAgencyRatesStore } from './infra/agency-rates-store';
import { createDrizzleAgencyShareCheck, type SalesTotalsRead } from './infra/agency-share-check';
import { createDrizzleCalendarLinkStore } from './infra/calendar-link-store';
import { createDrizzleCalendarReads } from './infra/calendar-reads';
import { createDrizzleColleagueReads } from './infra/colleague-reads';
import {
  createCreatorOnDutyRoutes,
  createDrizzleCreatorAccountShifts,
  createDrizzleCreatorOnDuty,
} from './infra/creator-on-duty';
import { createDrizzleShiftFeedbackStore } from './infra/feedback-store';
import { createDrizzleLeaveStore } from './infra/leave-store';
import {
  accessMarginMinutesForPay,
  accountSourcesForPay,
  reportsAwaitingReviewScoped,
  shiftsForPay,
  validatedReportsScoped,
  validatedReportsUnscoped,
  type AccountSourceForPay,
  type CreatorReportsForPay,
  type EnqueuePayRecalculation,
  type ShiftForPay,
  type ValidatedReportForPay,
} from './infra/pay-reads';
import { createDrizzlePayRulesStore, type SwitchFactsRead } from './infra/pay-rules-store';
import { createDrizzlePlanningAdmin, createDrizzlePlanningStore } from './infra/planning-store';
import { createDrizzleShiftReportStore } from './infra/report-store';
import { createSchedulingRoutes, type RequireRole } from './infra/routes';
import { agencyTimeZone } from './infra/rows';
import { createDrizzleSwapStore } from './infra/swap-store';

/** @public The accounts the automatic sales check compares (CRM-04 b3), read on the job's admin connection. */
export { salesCheckReads } from './infra/sales-check-reads';
/** @public An account the automatic sales check compares: its platform and its rules' currency. */
export type { DetectedAccountForCheck } from './domain/sales-checks';

/** Public entry point of the `scheduling` module (EQ-02, ADR 0002). Other modules import this file only. */
export interface SchedulingModule {
  readonly name: 'scheduling';
  /**
   * Mounted under `/v1` by the server: `/scheduling/…` (contracts `scheduling.ts`, `shift-reports.ts` and `shift-feedback.ts`),
   * `/team/pay-rules` (contract `pay-rules.ts`): the reports read an account's rules in their own transaction, and
   * `/creators/:creatorId/agency-rates` (contract `agency-rates.ts`, CR-04): the agency's percentage of a creator.
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
    /**
     * For the sales pay counts (CRM-03, ADR 0050 §§ 5, 8), in pay's transaction and under its policies (admin for the
     * job, creator by creator for a validation): every account's dated rules with its platform, the shifts on some
     * accounts over a range, cancelled ones left out, and the access margin around a shift.
     */
    readonly accountSources: (tx: Transaction) => Promise<AccountSourceForPay[]>;
    readonly shifts: (
      tx: Transaction,
      platformAccountIds: readonly PlatformAccountId[],
      from: Date,
      to: Date,
    ) => Promise<ShiftForPay[]>;
    readonly accessMarginMinutes: (tx: Transaction) => Promise<number>;
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
    /**
     * `scheduling.check_agency_shares` (CRM-04 lot d3), on the 2nd and the 17th: each creator's part read on the
     * platform against her agency percentage over the fortnight just over; how many `agency_share_mismatch` were new.
     * It changes no amount.
     */
    readonly checkAgencyShares: (correlationId: string) => Promise<number>;
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
  /**
   * What the switch of an account to `detected` rests on (ADR 0050 § 8, CRM-03): the `connectors` module's
   * `salesFeedSwitchReads.switchFactsOf`, read in the pay rules' own transaction.
   */
  readonly switchFactsOf: SwitchFactsRead;
  /**
   * A creator's sales totals (CRM-04): the `connectors` module's `salesFeedTotals.totalsOf`, read on the admin
   * connection by the agency percentages' check (lot d3).
   */
  readonly salesTotalsOf: SalesTotalsRead;
  /** A creator's agenda in her calendar link's feed (CR-05 lot c2): the `creator-tasks` module's `feedOf`. */
  readonly creatorAgendaFeed: CreatorAgendaFeed;
  readonly now?: () => Date;
}

export function createSchedulingModule(deps: SchedulingDeps): SchedulingModule {
  const now = deps.now ?? (() => new Date());
  const admin = createDrizzlePlanningAdmin(deps.adminDb);
  const colleagues = createDrizzleColleagueReads(deps.adminDb);
  const planning = createDrizzlePlanningStore(deps.db, deps.adminDb);
  const calendarReads = createDrizzleCalendarReads(deps.db);
  const shareCheck = createDrizzleAgencyShareCheck(deps.adminDb, deps.salesTotalsOf);
  const services = {
    scheduling: createSchedulingService(planning, admin, deps.creators, now),
    calendar: createCalendarService(calendarReads, deps.creators, now),
    calendarLinks: createCalendarLinkService(
      createDrizzleCalendarLinkStore(deps.adminDb),
      calendarReads,
      deps.creators,
      deps.creatorAgendaFeed,
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
    feedback: createShiftFeedbackService(createDrizzleShiftFeedbackStore(deps.db, deps.adminDb), now),
    payRules: createPayRulesService(
      createDrizzlePayRulesStore(deps.db, deps.adminDb, deps.switchFactsOf),
      deps.creators,
      now,
    ),
    agencyRates: createAgencyRatesService(createDrizzleAgencyRatesStore(deps.db), deps.creators, now),
  };
  return {
    name: 'scheduling',
    onShift: (creatorId, at) => admin.onShiftUnscoped(creatorId, at),
    pay: {
      validatedReportsUnscoped,
      validatedReportsScoped,
      reportsAwaitingReviewScoped,
      agencyTimeZone,
      accountSources: accountSourcesForPay,
      shifts: shiftsForPay,
      accessMarginMinutes: accessMarginMinutesForPay,
    },
    routes: (requireRole) => async (app, options) => {
      await createSchedulingRoutes(services, requireRole)(app, options);
      // Her « qui est en poste » (CR-02) and her accounts' shifts in her Agenda (CR-05 c3): the creator's own door,
      // never the team's routes.
      await createCreatorOnDutyRoutes(
        { onDuty: createDrizzleCreatorOnDuty(deps.db), shifts: createDrizzleCreatorAccountShifts(deps.db) },
        requireRole,
        now,
      )(app, options);
    },
    jobs: {
      makeShifts: (logger) => makeShifts(admin, logger, now()),
      lapseSwaps: () => colleagues.lapseSwapsUnscoped(now()),
      checkAgencyShares: (correlationId) => shareCheck.run(now(), correlationId),
    },
  };
}
