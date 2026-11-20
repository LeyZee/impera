/** Public entry point of the `supervision` module (ADR 0002). Other modules import this file only. */
import type { AgencyInsights, AgencyPeriod, CreatorId, Platform } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { readAgencyInsights, type AgencyReader } from './application/agency-reads';
import { createDashboardRoutes, type DashboardRouteDeps } from './infra/http/dashboard-routes';
import {
  createAgencyInsightsReader,
  type DailyStatsOf,
  type RefundListOf,
} from './infra/views/agency-insights-reader';
import { createCreatorsOverviewReader } from './infra/views/creators-overview-reader';
import { createDashboardReader } from './infra/views/dashboard-reader';
import { createRevealSalesReader, type SalesTotalsOf } from './infra/views/reveal-sales-reader';
import { createSetupReader, type BillingReadiness, type TelegramReach } from './infra/views/setup-reader';

export interface SupervisionModule {
  readonly name: 'supervision';
  /** `GET /v1/dashboard`, `/dashboard/todos`, `/dashboard/creators`, `/dashboard/agency` and `/dashboard/setup/*`, mounted under `/v1` by the server. */
  readonly routes: FastifyPluginAsyncZod;
  /** What another module reads, as the person reading (ADR 0026 § 1). */
  readonly reads: {
    /**
     * The agency's figures of every creator the person reads, by the rule of `GET /v1/dashboard/agency` (ADR 0078
     * § 1): `null` for a creator, a chatter or anyone whose team scope reads none of them, and for a creator named
     * out of a manager's list. Named, her figures alone.
     */
    agencyInsights(
      reader: AgencyReader,
      period: AgencyPeriod,
      creatorId?: CreatorId,
    ): Promise<AgencyInsights | null>;
  };
}

export interface SupervisionDeps extends Omit<
  DashboardRouteDeps,
  'reader' | 'revealSales' | 'overview' | 'agency' | 'agencyTimeZone' | 'setup'
> {
  /** Application role: the Dashboard reads in tenant transactions (RLS). */
  readonly db: Database;
  /** Admin role: « Mise en route » reads her account, passwords, passkeys and extension links (owner's routes only). */
  readonly adminDb: Database;
  /** Whether an urgent alert reaches a group for each creator; `null` when Telegram is off. */
  readonly telegramReach: TelegramReach;
  /** What stops each member's first invoice (invoicing's `invoiceReadiness`), for his « Facturation » step. */
  readonly billingReadiness: BillingReadiness;
  /** The connectors' `salesFeedTotals.totalsOf` (CRM-04), for the sales panel. */
  readonly salesTotalsOf: SalesTotalsOf;
  /** The zone a platform counts its days in (the connectors'), `null` without a sales feed. */
  readonly salesTimeZone: (platform: Platform) => string | null;
  /** The connectors' snapshot of the platforms' daily statistics (ADR 0081), read under the caller's RLS. */
  readonly dailyStatsOf: DailyStatsOf;
  /** The connectors' refunds one by one (ADR 0092 § 4), for the agency's list. */
  readonly refundListOf: RefundListOf;
}

export function createSupervisionModule(deps: SupervisionDeps): SupervisionModule {
  const agency = createAgencyInsightsReader(
    deps.db,
    deps.salesTotalsOf,
    deps.salesTimeZone,
    deps.dailyStatsOf,
    deps.refundListOf,
  );
  const agencyTimeZone = deps.salesTimeZone('reveal') ?? 'Europe/Paris';
  return {
    name: 'supervision',
    routes: createDashboardRoutes({
      ...deps,
      reader: createDashboardReader(deps.db),
      revealSales: createRevealSalesReader(deps.db, deps.salesTotalsOf),
      agency,
      agencyTimeZone,
      setup: createSetupReader(deps.adminDb, deps.telegramReach, deps.billingReadiness, agencyTimeZone),
      overview: createCreatorsOverviewReader(deps.db),
    }),
    reads: {
      agencyInsights: async (reader, period, creatorId) => {
        const answer = await readAgencyInsights(
          { ...deps, agency, agencyTimeZone },
          reader,
          { kind: 'rolling', period },
          creatorId,
        );
        return answer.kind === 'read' ? answer.insights : null;
      },
    },
  };
}
