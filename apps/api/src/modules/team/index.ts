import type { MemberDepartureId, TeamMember, UserId } from '@impera/contracts';
import type { Database, Transaction } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createAnnouncementService } from './application/announcements';
import { createReviewService } from './application/review';
import { createTeamService, type InviteFromPlatform } from './application/team';
import { calendarDayIn } from './domain/members';
import type {
  Actor,
  CreatorNames,
  CreatorRoster,
  InvitationLinkDirectory,
  PlatformRemovals,
  RemarkExcerpts,
  ShiftRemarkSource,
} from './domain/ports';
import { createDrizzleAnnouncementStore } from './infra/announcement-store';
import { createDepartureStore } from './infra/departure-store';
import { createAnnouncementRoutes } from './infra/http/announcement-routes';
import { createDepartureRoutes } from './infra/http/departure-routes';
import { createReviewRoutes } from './infra/http/review-routes';
import { createTeamRoutes, type RequireRole } from './infra/http/routes';
import { membersForPay, type MemberForPay } from './infra/pay-reads';
import { createDrizzleReviewStore } from './infra/review-store';
import { applyRolesUnscoped } from './infra/role-jobs';
import {
  createDrizzleTeamInvites,
  createDrizzleTeamStore,
  type EnqueuePayRecalculation,
  type PlatformChatterLinks,
} from './infra/team-store';

/** Until the agency has a setting of its own (ADR 0023 § Paie): where « today » is read for rates, roles and presets. */
const DEFAULT_AGENCY_TIME_ZONE = 'Europe/Paris';

/** Until the agent reviews shifts (ADR 0170 § 32): no remark anywhere. */
const NO_REMARKS: ShiftRemarkSource = {
  remarksFor: () => Promise.resolve([]),
  remarksOfChatter: () => Promise.resolve([]),
  remark: () => Promise.resolve(null),
};

/** Public entry point of the `team` module (ADR 0002). Other modules import this file only. */
export interface TeamModule {
  readonly name: 'team';
  /**
   * Mounted under `/v1` by the server: `/team/members` and `/team/commission-presets` (EQ-01), `/team/departures`
   * (ADR 0166); `recentLogin` guards every write of the owner (EQ-15).
   */
  routes(requireRole: RequireRole, recentLogin: preValidationAsyncHookHandler): FastifyPluginAsyncZod;
  /** Mounted under `/v1` by the server: `/team/announcements` (EQ-12), the owner's and the team's accounts. */
  announcementRoutes(requireRole: RequireRole): FastifyPluginAsyncZod;
  /** Mounted under `/v1` by the server: `/team/review` (ADR 0170 §§ 12 to 14, 26 to 30), « Mon bilan » and contests. */
  reviewRoutes(requireRole: RequireRole): FastifyPluginAsyncZod;
  /**
   * What pay reads of the team (EQ-04), in pay's own transaction, given by the composition root: every member with
   * the rate in force on a day (pay's job on the admin connection, or a validation as its member).
   */
  readonly pay: { readonly members: (tx: Transaction, day: string) => Promise<MemberForPay[]> };
  /**
   * The invitation of a member from a link proposal (ADR 0076 § 3), for `connectors`' route: given the link
   * writes of `connectors` by the composition root, it creates the member and links his account in one transaction,
   * as the owner or an active manager within his bounds (a chatter, a preset in force, creators of his own list).
   */
  invites(links: PlatformChatterLinks): {
    readonly fromPlatform: (actor: Actor, input: InviteFromPlatform) => Promise<TeamMember>;
  };
  readonly jobs: {
    /**
     * `team.apply_roles` (hourly): each record takes the role in force today, a role dated for today taking effect
     * for access; how many changed.
     */
    applyRoles(): Promise<number>;
    /**
     * `team.member_departure`, at the hour a departure ends (ADR 0166 § 2), in the name of the owner who set it or of an
     * owner in office:
     * whether it applied now (false when cancelled or already applied).
     */
    applyDeparture(id: MemberDepartureId, scheduledBy: UserId): Promise<boolean>;
  };
}

export interface TeamDeps {
  /** Application role: the team's policies run through `withMember`. */
  readonly db: Database;
  /** Owner role, for `team.apply_roles`, which no account runs. */
  readonly adminDb: Database;
  /** The creators that exist, to refuse an unknown one in `creatorIds` (the `persona` module's directory). */
  readonly creators: CreatorRoster;
  /** The creators' names, for what an announcement says it is addressed to (the `persona` module's directory). */
  readonly creatorNames: CreatorNames;
  /** Each member's link out (EQ-10), for when it stops working. */
  readonly invitationLinks: InvitationLinkDirectory;
  /** Pay's `payroll.recalculate` for a period, which a new rate or role enqueues (the `payroll` module's, EQ-04). */
  readonly enqueuePayRecalculation: EnqueuePayRecalculation;
  /** The removals on a platform of members still in the team (ADR 0076 § 5), the `connectors` module's reading. */
  readonly platformRemovals: PlatformRemovals;
  /**
   * The agent's remarks on the chatters' shifts (ADR 0170 § 32), the `agent` module's reading. Without it, until the
   * agent reviews shifts, every review is empty.
   */
  readonly remarks?: ShiftRemarkSource;
  /** The messages a remark quotes, redrawn (ADR 0170 § 12), the `conversations` module's reading; without it, none. */
  readonly remarkExcerpts?: RemarkExcerpts;
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
  const reviews = createReviewService({
    store: createDrizzleReviewStore(deps.db),
    remarks: deps.remarks ?? NO_REMARKS,
    excerpts: deps.remarkExcerpts ?? (() => Promise.resolve([])),
    now,
  });
  const today = (at: Date): string => calendarDayIn(at, DEFAULT_AGENCY_TIME_ZONE);
  const departures = createDepartureStore(deps.db, deps.adminDb, now, today);
  const announcements = createAnnouncementService(
    createDrizzleAnnouncementStore(deps.db, now),
    deps.creatorNames,
  );
  return {
    name: 'team',
    announcementRoutes: (requireRole) => createAnnouncementRoutes(announcements, requireRole),
    reviewRoutes: (requireRole) => createReviewRoutes(reviews, requireRole),
    routes: (requireRole, recentLogin) => {
      const members = createTeamRoutes(service, requireRole, deps.platformRemovals, recentLogin);
      const leaving = createDepartureRoutes(departures, requireRole, recentLogin);
      return async (app) => {
        await app.register(members);
        await app.register(leaving);
      };
    },
    pay: { members: membersForPay },
    invites: (links) => {
      const invites = createDrizzleTeamInvites(deps.db, links);
      return { fromPlatform: (actor, input) => service.inviteFromPlatform(actor, input, invites) };
    },
    jobs: {
      applyRoles: async () => (await applyRolesUnscoped(deps.adminDb, today(now()))).length,
      applyDeparture: (id, scheduledBy) => departures.apply(id, scheduledBy),
    },
  };
}
