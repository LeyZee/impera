import {
  PlatformSchema,
  TeamImportCountsSchema,
  TeamImportDismissalBodySchema,
  TeamImportLinksBodySchema,
  TeamImportLinksResultSchema,
  TeamImportOverviewSchema,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { TeamImport } from '../../application/team-import';
import { SalesFeedTeamForbidden } from '../../domain/errors';

const PlatformParamsSchema = z.object({ platform: PlatformSchema });
const ChatterParamsSchema = PlatformParamsSchema.extend({ platformChatterId: z.string().min(1).max(200) });

const userOf = (request: FastifyRequest): string => {
  const id = request.user?.id;
  if (id === undefined) throw new SalesFeedTeamForbidden();
  return id;
};

/**
 * `/v1/settings/sales-feeds/:platform/team` (ADR 0076): the platform's team reviewed by the owner or an active
 * manager. The guard lets the owner and the team's accounts in; the base decides who is a manager (`withMember`) and
 * keeps a manager's own record out of his reach. The invitation from a row is `team`'s route (ADR 0076 § 3).
 */
export function createSalesFeedTeamRoutes(
  team: TeamImport,
  guard: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', guard);

    app.get(
      '/settings/sales-feeds/:platform/team',
      { schema: { params: PlatformParamsSchema, response: { 200: TeamImportOverviewSchema } } },
      (request) => team.overview(request.params.platform, userOf(request)),
    );

    // The badges (§ 5, § 6): read in the base, never a call to the platform.
    app.get(
      '/settings/sales-feeds/:platform/team/counts',
      { schema: { params: PlatformParamsSchema, response: { 200: TeamImportCountsSchema } } },
      (request) => team.counts(request.params.platform, userOf(request)),
    );

    app.post(
      '/settings/sales-feeds/:platform/team/links',
      {
        schema: {
          params: PlatformParamsSchema,
          body: TeamImportLinksBodySchema,
          response: { 200: TeamImportLinksResultSchema },
        },
      },
      (request) => team.link(request.params.platform, userOf(request), request.body),
    );

    app.put(
      '/settings/sales-feeds/:platform/team/:platformChatterId/dismissal',
      {
        schema: {
          params: ChatterParamsSchema,
          body: TeamImportDismissalBodySchema,
          response: { 200: TeamImportOverviewSchema },
        },
      },
      (request) =>
        team.dismiss(
          request.params.platform,
          userOf(request),
          request.params.platformChatterId,
          request.body.dismissed,
        ),
    );

    return Promise.resolve();
  };
}
