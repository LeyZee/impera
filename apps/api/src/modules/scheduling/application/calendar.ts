import {
  PlanningMemberSchema,
  type Calendar,
  type CalendarQuery,
  type CalendarSlot,
  type CreatorId,
  type CreatorSummary,
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
  StoredAccount,
  StoredShift,
} from '../domain/ports';
import { assertPlanningRange } from '../domain/shifts';

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
      // The filters narrow what is sent back; the database already decided what the reader may read.
      const askedCreator = (creatorId: CreatorId) =>
        query.creatorId === undefined || creatorId === query.creatorId;
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
      // A member restricted to their own shifts learns of no creator beyond theirs.
      const named = new Set(read.shifts.map((row) => row.creatorId));
      const listed = directory.filter(
        (creator) => askedCreator(creator.id) && (read.view !== 'own' || named.has(creator.id)),
      );
      const agents = read.agents.filter((agent) => askedCreator(agent.creatorId));
      return {
        view: read.view,
        settings,
        creators: listed.map((creator) => ({ id: creator.id, name: creator.displayName })),
        members: [...members.values()],
        shifts: shifts.map((row) => ({
          memberId: row.memberId,
          creatorId: row.creatorId,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
        })),
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
      readonly away: ReadonlySet<string>;
    },
    window: { readonly from: Date; readonly to: Date },
    memberId: TeamMemberId | undefined,
    agents: readonly CreatorAgent[],
    settings: SchedulingSettings,
    directory: readonly CreatorSummary[],
    askedCreator: (creatorId: CreatorId) => boolean,
  ): NonNullable<Calendar['agency']> {
    const names = new Map(directory.map((creator) => [creator.id, creator]));
    const accounts = planned.accounts.filter((account) => askedCreator(account.creatorId));
    // A member who is not at work holds no créneau (recette EQP-03): his shifts stay planned, their créneaux are to fill.
    const held = planned.shifts.filter((shift) => !planned.away.has(shift.memberId));
    const { toFill, aiAlone } = slotsToFill({
      settings,
      accounts,
      shifts: held,
      agents,
      window,
      now: now(),
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
