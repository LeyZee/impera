import {
  PlanningMemberSchema,
  type Calendar,
  type CalendarQuery,
  type CalendarSlot,
  type CreatorId,
  type CreatorSummary,
  type SchedulingSettings,
  type UserId,
} from '@nirvana/contracts';

import { coverageOf, slotsToFill, workloadOf, type CreatorAgent, type GridSlot } from '../domain/calendar';
import type { CalendarReads, CalendarRow, CreatorDirectory, PlanningStore } from '../domain/ports';
import { assertPlanningRange, DEFAULT_SCHEDULING_SETTINGS } from '../domain/shifts';

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
});

export function createCalendarService(
  reads: CalendarReads,
  store: PlanningStore,
  creators: CreatorDirectory,
  now: () => Date = () => new Date(),
): CalendarService {
  return {
    calendar: async (actor, query) => {
      const window = { from: new Date(query.from), to: new Date(query.to) };
      assertPlanningRange(window.from, window.to);
      const read = await reads.read(actor, window);
      const settings = (await store.settings(actor)) ?? DEFAULT_SCHEDULING_SETTINGS;
      const directory = await creators.list();
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
        agent: agents.map((agent) => ({ ...agent })),
        agency:
          read.view === 'agency'
            ? await agencyOf(actor, window, shifts, agents, settings, directory, askedCreator)
            : null,
      };
    },
  };

  /**
   * What the owner and an active manager read on top (ADR 0045 § 1 and § 2): the accounts, the créneaux to fill and
   * those the agent holds alone, each member's hours, the coverage of each account. The accounts and their shifts come
   * from the planning's read, under the same policies as Planning.
   */
  async function agencyOf(
    actor: UserId,
    window: { readonly from: Date; readonly to: Date },
    shifts: readonly CalendarRow[],
    agents: readonly CreatorAgent[],
    settings: SchedulingSettings,
    directory: readonly CreatorSummary[],
    askedCreator: (creatorId: CreatorId) => boolean,
  ): Promise<NonNullable<Calendar['agency']>> {
    const planned = await store.read(
      actor,
      directory.map((creator) => creator.id),
      window,
    );
    const names = new Map(directory.map((creator) => [creator.id, creator]));
    const accounts = planned.accounts.filter((account) => askedCreator(account.creatorId));
    const { toFill, aiAlone } = slotsToFill({
      settings,
      accounts,
      shifts: planned.shifts,
      agents,
      window,
      now: now(),
    });
    const agentOf = new Map(agents.map((agent) => [agent.creatorId, agent]));
    return {
      accounts: accounts.map((account) => toPlanningAccount(account, names)),
      toFill: toFill.map(toSlot),
      aiAlone: aiAlone.map(toSlot),
      workload: workloadOf(shifts, window),
      coverage: accounts.map((account) => ({
        platformAccountId: account.id,
        ...coverageOf(
          planned.shifts.filter((shift) => shift.platformAccountId === account.id),
          agentOf.get(account.creatorId) ?? null,
          window,
        ),
      })),
    };
  }
}
