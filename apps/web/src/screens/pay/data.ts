import {
  calendarDayAt,
  type ExchangeRate,
  type PayPeriod,
  type PayrollPeriod,
  type PlanningAccount,
  type PlanningMember,
  type ShiftReport,
  type TeamMember,
} from '@nirvana/contracts';

import { useExchangeRates, usePayPeriod, usePayPeriodReads, usePayPeriods } from '@/payroll/api';
import {
  draftPeriodsBefore,
  firstOpenPeriod,
  inCfaFrancZone,
  periodToOpen,
  rateMissing,
  validatable,
} from '@/payroll/model';
import { usePayRules, useReports, useSchedulingSettings } from '@/reports/api';
import { periodAt } from '@/reports/model';
import { useNow } from '@/scheduling/useNow';
import { useMembers } from '@/screens/team/api';

/**
 * What Paie's screens read besides a period (EQ-05): the period Quinzaine opens on, what stops a period from being
 * validated before anyone tries, and the names behind the ids of a statement. The server's refusals stay the rule.
 */

/** Today in the agency's zone, the day the server reads pay's rules against (PAIE-22); null until the zone is read. */
export function useAgencyToday(): string | null {
  const now = useNow();
  const settings = useSchedulingSettings();
  return settings.data === undefined ? null : calendarDayAt(now, settings.data.timeZone);
}

/** The period under way in the agency's zone, `null` until its settings are read. */
export function useCurrentPeriod(): PayPeriod | null {
  const now = useNow();
  const settings = useSchedulingSettings();
  return settings.data === undefined ? null : periodAt(now, settings.data.timeZone);
}

/** The period Quinzaine opens on without a choice: the oldest with something left to do, else the one under way. */
export function usePeriodToOpen(owner: boolean): PayPeriod | null {
  const current = useCurrentPeriod();
  const index = usePayPeriods();
  if (current === null) return null;
  if (index.isError) return current;
  const first = index.data?.pages[0];
  return first === undefined ? null : periodToOpen(first.items, current, owner);
}

/** What stops a period from being validated, seen before anyone tries: reports to review, the dollar's rate. */
export type PeriodBlock =
  | {
      readonly kind: 'reports_pending';
      readonly reports: readonly ShiftReport[];
      /** Who and which day each report is from, as the reports' list names them. */
      readonly whose: (report: ShiftReport) => { readonly name: string; readonly startsAt: string | null };
    }
  | {
      readonly kind: 'rate_missing';
      /** The latest rate the daily job read, to say how old it is. */
      readonly latest: ExchangeRate | null;
    };

/** The pre-checks of an ended period that is not closed yet: reports still submitted, then a missing rate. */
export function usePeriodBlock(period: PayrollPeriod | undefined): PeriodBlock | null {
  const open = period !== undefined && period.ended && period.closing === null;
  const reports = useReports(period?.period ?? null, open);
  const foreign =
    open && period.statements.some((statement) => statement.lines.some((line) => line.currency !== 'EUR'));
  const rates = useExchangeRates(foreign);
  if (!open) return null;
  const pending = (reports.data?.reports ?? []).filter((report) => report.status === 'submitted');
  if (pending.length > 0) {
    const members = new Map((reports.data?.members ?? []).map((member) => [member.id, member]));
    const shifts = new Map((reports.data?.shifts ?? []).map((shift) => [shift.id, shift]));
    return {
      kind: 'reports_pending',
      reports: pending,
      whose: (report) => ({
        name: members.get(report.memberId)?.displayName ?? 'Un membre',
        startsAt: shifts.get(report.shiftId)?.startsAt ?? null,
      }),
    };
  }
  const latest = rates.data?.usd ?? null;
  if (foreign && rateMissing(period, latest)) return { kind: 'rate_missing', latest };
  return null;
}

/** The count on the Quinzaine tab: what the reader may validate now in the period to validate, nothing when blocked. */
export function useValidateCount(): number {
  const index = usePayPeriods();
  const waiting = (index.data?.pages[0]?.items ?? []).filter(
    (summary) => summary.ended && summary.statements.draft > 0,
  );
  const target = waiting.at(-1)?.window.period ?? null;
  const read = usePayPeriod(target);
  const block = usePeriodBlock(read.data);
  // A period pay could not compute validates nothing: its drafts are out of date.
  return read.data === undefined || block !== null || read.data.blocked !== null
    ? 0
    : validatable(read.data).length;
}

/**
 * The member's first period open to an entry, where the server puts an adjustment: `undefined` while it is being read
 * or without a member. After `after`, a statement of theirs already validated, when one is known.
 */
export function useFirstOpenPeriod(
  member: Pick<TeamMember, 'id' | 'joinedOn'> | null,
  after: PayPeriod | null,
): PayPeriod | undefined {
  const current = useCurrentPeriod();
  const index = usePayPeriods();
  // Without the list of periods (the server did not answer), the current one: the server says if it is not open.
  const known = current === null ? null : draftPeriodsBefore(index.data?.pages[0]?.items ?? [], current);
  const read = usePayPeriodReads(member === null || known === null ? [] : known.drafts);
  if (member === null || known === null || (index.data === undefined && !index.isError)) return undefined;
  return firstOpenPeriod({ memberId: member.id, joinedOn: member.joinedOn, after, ...known, read });
}

/** A member as pay names them: from the team's list, or from the reports' when the team's is not readable. */
export interface PayMember {
  readonly name: string;
  readonly color: string | null;
  readonly manager: boolean;
  readonly userId: string | null;
}

/** The names behind a period's ids: its members, the accounts of its lines, and whoever closed, validated or paid. */
export interface PayNames {
  readonly member: (memberId: string) => PayMember;
  readonly account: (platformAccountId: string) => PlanningAccount | null;
  readonly members: readonly TeamMember[];
}

const UNKNOWN: PayMember = { name: 'Un membre', color: null, manager: false, userId: null };

/** The team's members and accounts as the agency reads them (`/v1/team/members`, `/v1/team/pay-rules`). */
export function usePayNames(period: PayPeriod | null, agency: boolean): PayNames {
  const members = useMembers(agency);
  const rules = usePayRules(agency);
  // A member reads neither the team nor the rules: the reports of the period name their own accounts.
  const reports = useReports(period, !agency && period !== null);
  const team = new Map<string, TeamMember>((members.data ?? []).map((member) => [member.id, member]));
  const planned = new Map<string, PlanningMember>(
    (reports.data?.members ?? []).map((member) => [member.id, member]),
  );
  const accounts = new Map<string, PlanningAccount>([
    ...(reports.data?.accounts ?? []).map((account): [string, PlanningAccount] => [account.id, account]),
    ...(rules.data?.accounts ?? []).map(({ account }): [string, PlanningAccount] => [account.id, account]),
  ]);
  return {
    member: (memberId) => {
      const known = team.get(memberId);
      if (known !== undefined)
        return {
          name: known.displayName,
          color: known.color,
          manager: known.teamRole === 'manager',
          userId: known.userId,
        };
      const seen = planned.get(memberId);
      return seen === undefined ? UNKNOWN : { ...UNKNOWN, name: seen.displayName, color: seen.color };
    },
    account: (platformAccountId) => accounts.get(platformAccountId) ?? null,
    members: members.data ?? [],
  };
}

/**
 * Whether the member of a statement is paid in CFA francs, read from their line of the team: the whole team for the
 * agency, their own line alone for a member (`/v1/team/members`, scope `self`). `false` until it is read.
 */
export function useCfaFrancs(memberId: string | undefined): boolean {
  const members = useMembers(memberId !== undefined);
  const member = members.data?.find((one) => one.id === memberId);
  return member !== undefined && inCfaFrancZone(member.country);
}
