import {
  PlanningMemberSchema,
  type Calendar,
  type CalendarQuery,
  type CalendarSlot,
  type CreatorId,
  type SchedulingSettings,
  type TeamMemberId,
  type UserId,
} from '@impera/contracts';

import {
  agentReplySpans,
  coverageOf,
  slotsToFill,
  workloadOf,
  type CreatorAgent,
  type GridSlot,
} from '../domain/calendar';
import type {
  CalendarReads,
  CalendarRow,
  CreatorDirectory,
  ListedCreator,
  PlannedMember,
  StoredAccount,
  StoredShift,
} from '../domain/ports';
import { assertPlanningRange, heldUntil, plansCreator, unheldOf } from '../domain/shifts';

import { toPlanningAccount } from './dto';

/** Équipe › Calendrier (CR-12, ADR 0045 § 1 and § 2, ADR 0048): who chats when, for every member of the team. */
export interface CalendarService {
  calendar(actor: UserId, query: CalendarQuery): Promise<Calendar>;
}

const toSlot = (slot: GridSlot): CalendarSlot => ({
  platformAccountId: slot.platformAccountId,
  creatorId: slot.creatorId,
  startsAt: slot.startsAt.toISOString(),
  endsAt: slot.endsAt.toISOString(),
  seats: slot.seats,
  places: slot.places,
  open: slot.open.map((gap) => ({ startsAt: gap.from.toISOString(), endsAt: gap.to.toISOString() })),
});

export function createCalendarService(
  reads: CalendarReads,
  creators: CreatorDirectory,
  now: () => Date = () => new Date(),
): CalendarService {
  return {
    calendar: async (actor, query) => {
      const window = { from: new Date(query.from), to: new Date(query.to) };
      assertPlanningRange(window.from, window.to);
      const directory = await creators.list();
      const read = await reads.read(
        actor,
        window,
        directory.map((creator) => creator.id),
      );
      const { settings } = read;
      // The filters narrow what is sent back; the database already decided what the reader may read, and a manager is
      // shown the creators he plans (Charles, 06/11).
      const askedCreator = (creatorId: CreatorId) =>
        (query.creatorId === undefined || creatorId === query.creatorId) &&
        plansCreator(read.planned, creatorId);
      const asked = (row: CalendarRow) =>
        askedCreator(row.creatorId) && (query.memberId === undefined || row.memberId === query.memberId);
      const shifts = read.shifts.filter(asked);
      const members = new Map(
        shifts.map((row) => [
          row.memberId,
          PlanningMemberSchema.parse({
            id: row.memberId,
            displayName: row.memberName,
            color: row.memberColor,
          }),
        ]),
      );
      // A member restricted to their own shifts learns of no creator beyond theirs, and an archived creator is there
      // for her shifts of the window alone, her history (ADR 0071 § 2).
      const named = new Set(read.shifts.map((row) => row.creatorId));
      const listed = directory.filter(
        (creator) =>
          askedCreator(creator.id) && ((read.view !== 'own' && !creator.archived) || named.has(creator.id)),
      );
      const agents = read.agents.filter((agent) => askedCreator(agent.creatorId));
      // Who of the agency's shifts holds nothing, as Planning says it (recette EQU-01, EQU-02): the agency's alone.
      const unheld =
        read.agency === null
          ? { away: [], withoutAccess: [] }
          : unheldOf(
              read.agency.members,
              read.agency.shifts.filter(
                (shift) =>
                  askedCreator(shift.creatorId) &&
                  (query.memberId === undefined || shift.memberId === query.memberId),
              ),
            );
      return {
        view: read.view,
        settings,
        creators: listed.map((creator) => ({
          id: creator.id,
          name: creator.displayName,
          archived: creator.archived,
        })),
        members: [...members.values()],
        shifts: shifts.map((row) => ({
          memberId: row.memberId,
          creatorId: row.creatorId,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
        })),
        ...unheld,
        agent: agents.map((agent) => ({
          ...agent,
          answers: agentReplySpans(agent, window).map((span) => ({
            startsAt: span.from.toISOString(),
            endsAt: span.to.toISOString(),
          })),
        })),
        agency:
          read.agency === null
            ? null
            : agencyOf(read.agency, window, query.memberId, agents, settings, directory, askedCreator),
      };
    },
  };

  /**
   * What the owner and an active manager read on top (ADR 0045 § 1 and § 2): the accounts, the créneaux to fill and
   * those the agent holds alone, each member's hours, the coverage of each account, from the accounts and shifts the
   * same snapshot read under the same policies as Planning.
   */
  function agencyOf(
    planned: {
      readonly accounts: readonly StoredAccount[];
      readonly shifts: readonly StoredShift[];
      readonly members: readonly PlannedMember[];
    },
    window: { readonly from: Date; readonly to: Date },
    memberId: TeamMemberId | undefined,
    agents: readonly CreatorAgent[],
    settings: SchedulingSettings,
    directory: readonly ListedCreator[],
    askedCreator: (creatorId: CreatorId) => boolean,
  ): NonNullable<Calendar['agency']> {
    const names = new Map(directory.map((creator) => [creator.id, creator]));
    // Who to plan: never an archived creator's account (ADR 0071 § 2), whose créneaux are nobody's to fill.
    const accounts = planned.accounts.filter(
      (account) => askedCreator(account.creatorId) && names.get(account.creatorId)?.archived !== true,
    );
    // A shift its member does not hold covers nothing from now on (recette EQP-03, EQU-01): it stays planned, its
    // créneau to fill; what went by stays covered as it was planned.
    const at = now();
    const members = new Map<string, PlannedMember>(planned.members.map((member) => [member.id, member]));
    const held = heldUntil(members, planned.shifts, at);
    const { toFill, aiAlone } = slotsToFill({
      settings,
      accounts,
      shifts: held,
      agents,
      window,
      now: at,
    });
    const agentOf = new Map(agents.map((agent) => [agent.creatorId, agent]));
    return {
      accounts: accounts.map((account) => toPlanningAccount(account, names)),
      toFill: toFill.map(toSlot),
      aiAlone: aiAlone.map(toSlot),
      // From the same read as the créneaux and the coverage, so that the three agree.
      workload: workloadOf(
        planned.shifts.filter(
          (shift) => askedCreator(shift.creatorId) && (memberId === undefined || shift.memberId === memberId),
        ),
        window,
      ),
      coverage: accounts.map((account) => ({
        platformAccountId: account.id,
        ...coverageOf(
          held.filter((shift) => shift.platformAccountId === account.id),
          agentOf.get(account.creatorId) ?? null,
          window,
        ),
      })),
    };
  }
}
