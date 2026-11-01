import type { Database, Transaction } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createTeamService } from './application/team';
import { calendarDayIn } from './domain/members';
import type { CreatorRoster, InvitationLinkDirectory } from './domain/ports';
import { createTeamRoutes, type RequireRole } from './infra/http/routes';
import { membersForPay, type MemberForPay } from './infra/pay-reads';
import { applyRolesUnscoped } from './infra/role-jobs';
import { createDrizzleTeamStore, type EnqueuePayRecalculation } from './infra/team-store';

/** Until the agency has a setting of its own (ADR 0023 § Paie): where « today » is read for rates, roles and presets. */
const DEFAULT_AGENCY_TIME_ZONE = 'Europe/Paris';

/** Public entry point of the `team` module (ADR 0002). Other modules import this file only. */
export interface TeamModule {
  readonly name: 'team';
  /** Mounted under `/v1` by the server: `/team/members` and `/team/commission-presets` (EQ-01). */
  routes(requireRole: RequireRole): FastifyPluginAsyncZod;
  /**
   * What pay reads of the team (EQ-04), in pay's own transaction, given by the composition root: every member with
   * the rate in force on a day (pay's job on the admin connection, or a validation as its member).
   */
  readonly pay: { readonly members: (tx: Transaction, day: string) => Promise<MemberForPay[]> };
  readonly jobs: {
    /**
     * `team.apply_roles` (hourly): each record takes the role in force today, a role dated for today taking effect
     * for access; how many changed.
     */
    applyRoles(): Promise<number>;
  };
}

export interface TeamDeps {
  /** Application role: the team's policies run through `withMember`. */
  readonly db: Database;
  /** Owner role, for `team.apply_roles`, which no account runs. */
  readonly adminDb: Database;
  /** The creators that exist, to refuse an unknown one in `creatorIds` (the `persona` module's directory). */
  readonly creators: CreatorRoster;
  /** Each member's link out (EQ-10), for when it stops working. */
  readonly invitationLinks: InvitationLinkDirectory;
  /** Pay's `payroll.recalculate` for a period, which a new rate or role enqueues (the `payroll` module's, EQ-04). */
  readonly enqueuePayRecalculation: EnqueuePayRecalculation;
  readonly now?: () => Date;
}

export function createTeamModule(deps: TeamDeps): TeamModule {
  const now = deps.now ?? (() => new Date());
  const service = createTeamService(
    createDrizzleTeamStore(deps.db, deps.enqueuePayRecalculation, now),
    deps.creators,
    deps.invitationLinks,
    { agencyTimeZone: DEFAULT_AGENCY_TIME_ZONE, now },
  );
  return {
    name: 'team',
    routes: (requireRole) => createTeamRoutes(service, requireRole),
    pay: { members: membersForPay },
    jobs: {
      applyRoles: async () =>
        (await applyRolesUnscoped(deps.adminDb, calendarDayIn(now(), DEFAULT_AGENCY_TIME_ZONE))).length,
    },
  };
}
