import {
  PlatformSchema,
  TeamImportCountsSchema,
  TeamImportDismissalBodySchema,
  TeamImportInvitationBodySchema,
  TeamImportInvitationResultSchema,
  TeamImportLinksBodySchema,
  TeamImportLinksResultSchema,
  TeamImportOverviewSchema,
  UserIdSchema,
  type Platform,
  type TeamImportInvitationBody,
  type TeamMember,
  type UserId,
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
 * `team`'s invitation from a link proposal (ADR 0076 § 3), given by the composition root: the member made and the
 * account linked in one transaction, as the owner or an active manager within his bounds.
 */
export type InviteFromPlatform = (
  actor: { readonly userId: UserId; readonly ip: string | null },
  input: TeamImportInvitationBody & {
    readonly account: { readonly platform: Platform; readonly platformChatterId: string };
  },
) => Promise<TeamMember>;

export interface SalesFeedTeamRoutesOptions {
  /** The owner and the team's accounts; the base decides who is a manager. */
  readonly guard: preValidationAsyncHookHandler;
  /** The password asked again (§ 3): an invitation opens an account that reads fans' conversations. */
  readonly recentLogin: preValidationAsyncHookHandler;
  readonly invite: InviteFromPlatform;
}

/**
 * `/v1/settings/sales-feeds/:platform/team` (ADR 0076): the platform's team reviewed by the owner or an active
 * manager. The guard lets the owner and the team's accounts in; the base decides who is a manager (`withMember`) and
 * keeps a manager's own record out of his reach. The invitation from a row is checked here against the live list and
 * made by `team` (ADR 0076 § 3).
 */
export function createSalesFeedTeamRoutes(
  team: TeamImport,
  options: SalesFeedTeamRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

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

    // One row at a time, never in the batch (§ 1): the fields typed on screen, the password asked again. Played again
    // for the same account and e-mail, the same member (201 both times).
    app.post(
      '/settings/sales-feeds/:platform/team/:platformChatterId/invitation',
      {
        preValidation: options.recentLogin,
        schema: {
          params: ChatterParamsSchema,
          body: TeamImportInvitationBodySchema,
          response: { 201: TeamImportInvitationResultSchema },
        },
      },
      async (request, reply) => {
        const userId = userOf(request);
        const { platform, platformChatterId } = request.params;
        await team.invitable(platform, userId, platformChatterId);
        const member = await options.invite(
          { userId: UserIdSchema.parse(userId), ip: request.ip },
          { ...request.body, account: { platform, platformChatterId } },
        );
        return reply.code(201).send(member);
      },
    );

    return Promise.resolve();
  };
}
