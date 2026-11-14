import type {
  CreatorId,
  Currency,
  PayPeriod,
  PlatformAccountId,
  ShiftId,
  ShiftReportId,
  ShiftReportStatus,
  TeamMemberId,
  UserId,
  UserRole,
} from '@impera/contracts';

import { TeamScheduleReadForbidden } from '../domain/errors';
import type { CreatorDirectory, NamedMember, PlanningStore, ShiftReportStore } from '../domain/ports';
import { assertPlanningRange, plansCreator } from '../domain/shifts';
import { boundCreators, readsTeamSchedule, type CreatorBound } from '../domain/team-reads';

/**
 * The person a read is for, as the other door resolved them (`resolveActor`, ADR 0026 § 4): the same person the screen
 * would serve, never more. Their scope is read again by the database in each transaction (`withMember`).
 */
export interface ScheduleReader {
  readonly userId: UserId;
  readonly role: UserRole;
}

/** @public A shift as another door reads it: when, on which account, who by name; nothing of a template or conflict. */
export interface ListedShift {
  readonly id: ShiftId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  /** The member's name as the planning shows it; `null` when the policies do not show the reader that member. */
  readonly memberName: string | null;
  readonly startsAt: string;
  /** Its stop, when it was stopped under way (`shifts_stopped_check`). */
  readonly endsAt: string;
  readonly stopped: boolean;
}

/**
 * @public An end-of-shift report as another door reads it: its amount, state and dates. Never a text a person wrote
 * (comment, incident, explanation, review note), nor its check against the platform.
 */
export interface ListedShiftReport {
  readonly id: ShiftReportId;
  readonly shiftId: ShiftId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly memberName: string | null;
  readonly period: PayPeriod;
  /** The report it corrects, for a correction. */
  readonly correctsId: ShiftReportId | null;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly status: ShiftReportStatus;
  /** A correction the agency made. */
  readonly byAgency: boolean;
  readonly submittedAt: string;
  readonly reviewedAt: string | null;
}

/**
 * The planning and the reports for a door other than the routes (ADR 0026 § 1, the MCP's `shifts_list` and
 * `shift_reports_list`): the same stores, under the same policies and as the same person as the screen, confined in
 * addition to the creators the caller names. Nothing here is written.
 */
export interface SchedulingReads {
  /** The shifts not cancelled that overlap [`from`, `to`), `PLANNING_MAX_DAYS` at most, the earliest first. */
  shifts(
    reader: ScheduleReader,
    creators: CreatorBound,
    range: { readonly from: Date; readonly to: Date },
  ): Promise<ListedShift[]>;
  /**
   * With `period`, its reports and corrections; without, the reports still open (submitted or sent back) of every
   * period: what the agency has to validate. The oldest handed in first.
   */
  shiftReports(
    reader: ScheduleReader,
    creators: CreatorBound,
    period: PayPeriod | null,
  ): Promise<ListedShiftReport[]>;
}

const nameOf = (members: readonly NamedMember[]): ((id: TeamMemberId) => string | null) => {
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  return (id) => names.get(id) ?? null;
};

const byTime = (a: { at: number; id: string }, b: { at: number; id: string }): number =>
  a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function createSchedulingReads(
  planning: Pick<PlanningStore, 'read'>,
  reports: Pick<ShiftReportStore, 'list'>,
  creators: CreatorDirectory,
  now: () => Date = () => new Date(),
): SchedulingReads {
  const assertReader = (reader: ScheduleReader): void => {
    if (!readsTeamSchedule(reader.role)) throw new TeamScheduleReadForbidden();
  };
  /** Archived creators included, for their history, as on the screen. */
  const confined = async (bound: CreatorBound): Promise<CreatorId[]> =>
    boundCreators(
      bound,
      (await creators.list()).map((creator) => creator.id),
    );

  return {
    shifts: async (reader, bound, range) => {
      assertReader(reader);
      assertPlanningRange(range.from, range.to);
      const creatorIds = await confined(bound);
      if (creatorIds.length === 0) return [];
      const read = await planning.read(reader.userId, creatorIds, range);
      const name = nameOf(read.members);
      return (
        read.shifts
          // What a manager plans is what he is shown (Charles, 06/11): the others were read for the conflicts only.
          .filter(
            (shift) =>
              plansCreator(read.planned, shift.creatorId) &&
              shift.startsAt.getTime() < range.to.getTime() &&
              range.from.getTime() < shift.endsAt.getTime(),
          )
          .map((shift) => ({ at: shift.startsAt.getTime(), id: shift.id, shift }))
          .sort(byTime)
          .map(({ shift }) => ({
            id: shift.id,
            creatorId: shift.creatorId,
            platformAccountId: shift.platformAccountId,
            memberId: shift.memberId,
            memberName: name(shift.memberId),
            startsAt: shift.startsAt.toISOString(),
            endsAt: shift.endsAt.toISOString(),
            stopped: shift.stoppedAt !== null,
          }))
      );
    },

    shiftReports: async (reader, bound, period) => {
      assertReader(reader);
      const creatorIds = await confined(bound);
      if (creatorIds.length === 0) return [];
      const read = await reports.list(reader.userId, creatorIds, period, now());
      const name = nameOf(read.members);
      return read.reports
        .map((report) => ({ at: report.submittedAt.getTime(), id: report.id, report }))
        .sort(byTime)
        .map(({ report }) => ({
          id: report.id,
          shiftId: report.shiftId,
          creatorId: report.creatorId,
          platformAccountId: report.platformAccountId,
          memberId: report.memberId,
          memberName: name(report.memberId),
          period: report.period,
          correctsId: report.correctsId,
          amountMinor: report.amountMinor,
          currency: report.currency,
          status: report.status,
          byAgency: report.byAgency,
          submittedAt: report.submittedAt.toISOString(),
          reviewedAt: report.reviewedAt?.toISOString() ?? null,
        }));
    },
  };
}
