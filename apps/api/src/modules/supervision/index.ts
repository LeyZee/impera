/** Public entry point of the `supervision` module (ADR 0002). Other modules import this file only. */
import type { Platform } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDashboardRoutes, type DashboardRouteDeps } from './infra/http/dashboard-routes';
import { createAgencyInsightsReader } from './infra/views/agency-insights-reader';
import { createCreatorsOverviewReader } from './infra/views/creators-overview-reader';
import { createDashboardReader } from './infra/views/dashboard-reader';
import { createRevealSalesReader, type SalesTotalsOf } from './infra/views/reveal-sales-reader';

export interface SupervisionModule {
  readonly name: 'supervision';
  /** `GET /v1/dashboard`, `/dashboard/todos`, `/dashboard/creators` and `/dashboard/agency`, mounted under `/v1` by the server. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface SupervisionDeps extends Omit<
  DashboardRouteDeps,
  'reader' | 'revealSales' | 'overview' | 'agency' | 'agencyTimeZone'
> {
  /** Application role: the Dashboard reads in tenant transactions (RLS). */
  readonly db: Database;
  /** The connectors' `salesFeedTotals.totalsOf` (CRM-04), for the sales panel. */
  readonly salesTotalsOf: SalesTotalsOf;
  /** The zone a platform counts its days in (the connectors'), `null` without a sales feed. */
  readonly salesTimeZone: (platform: Platform) => string | null;
}

export function createSupervisionModule(deps: SupervisionDeps): SupervisionModule {
  return {
    name: 'supervision',
    routes: createDashboardRoutes({
      ...deps,
      reader: createDashboardReader(deps.db),
      revealSales: createRevealSalesReader(deps.db, deps.salesTotalsOf),
      agency: createAgencyInsightsReader(deps.db, deps.salesTotalsOf, deps.salesTimeZone),
      agencyTimeZone: deps.salesTimeZone('reveal') ?? 'Europe/Paris',
      overview: createCreatorsOverviewReader(deps.db),
    }),
  };
}
