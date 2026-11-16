import {
  calendarDayAt,
  type CommissionStatement,
  type CommissionStatementStatus,
  type PayPeriodBlock,
  type PayPeriodWindow,
  type TeamMemberId,
  type TeamScope,
  type UserRole,
} from '@impera/contracts';

/**
 * Who reads the statements (EQ-04, ADR 0026 § 1): the owner and the team's accounts, each with what their scope gives
 * them (`withMember`), never a creator. The routes ask it of the session (`requireRole('owner', 'operator')`); the
 * reads another door calls ask it here, so that the rule is the same for both.
 */
export const readsPay = (role: UserRole): boolean => role === 'owner' || role === 'operator';

/**
 * A statement as another door reads it (ADR 0105 § 3 and § 4, decision A of 14/11, the MCP's
 * `commission_statements_list`): its state, never an amount. No amount of a member leaves (no net, commission, bonus,
 * penalty, total, payable), so neither a rate nor a member's pay can be read from it. Of a transfer that waits, only
 * that it waits: its reason speaks of the contractor's file (ADR 0105 § 4).
 */
export interface StatementState {
  readonly memberId: TeamMemberId;
  readonly status: CommissionStatementStatus;
  readonly revision: number;
  readonly computedAt: string;
  readonly validatedAt: string | null;
  readonly paidAt: string | null;
  /**
   * Validated, something to pay, and its transfer waits (a document not issued, a tax residence missing or
   * unverified), as the screen computes it for a transfer dated today (`payoutBlock`).
   */
  readonly payoutBlocked: boolean;
  /**
   * Validated, something to pay, nothing holding it, and past the delay the owner announced: `null` while he
   * announced none (not known), never `true` for a statement that pays nothing.
   */
  readonly payoutLate: boolean | null;
}

/**
 * A period as another door reads it: its window, its closing's date, why pay could not compute it (as the screen gives
 * it to the person), the delay announced, each statement's state, and the team's sums only for a person who sees the
 * whole team (the owner, an active manager), each only when two statements at least bring an amount to it: for a
 * member in `self`, or with a single statement that is not zero, the sum would be one member's pay.
 */
export interface PeriodState {
  readonly window: PayPeriodWindow | null;
  readonly closedAt: string | null;
  readonly blocked: PayPeriodBlock | null;
  readonly payoutDelayBusinessDays: number | null;
  readonly statements: readonly StatementState[];
  readonly team: TeamSums | null;
}

/**
 * The team's sums over the period's statements, in euro cents: never a member's. Each sum is `null` unless two
 * statements at least bring an amount other than zero to it, counted apart for the total and the payable (a statement
 * under the minimum payout has a total and nothing payable).
 */
export interface TeamSums {
  readonly statements: number;
  readonly totalMinor: number | null;
  readonly payableMinor: number | null;
}

type ReadStatement = Pick<
  CommissionStatement,
  | 'memberId'
  | 'status'
  | 'revision'
  | 'computedAt'
  | 'validatedAt'
  | 'paidAt'
  | 'totalMinor'
  | 'payableMinor'
  | 'payoutBlock'
>;

/**
 * Monday to Friday strictly after `from`, `to` included, two days as written: the working days gone by since a
 * validation. Holidays are not known here and count as working days.
 */
export function workingDaysSince(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000);
  let count = 0;
  for (let gap = 1; gap <= days; gap += 1) {
    const weekday = new Date(start + gap * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/** The agency's zone now and today in it, as the period was read: the day a transfer would be dated. */
export interface AgencyToday {
  readonly timeZone: string;
  readonly today: string;
}

/**
 * A transfer is late (« Versement en retard ») once more working days than announced have gone by since the day of
 * its validation, today included, both days read in the agency's zone now, as the route dates a transfer: validated
 * on a Monday with one day announced, it is due on the Tuesday and late on the Wednesday. `null` while the owner
 * announced no delay. Only a validated statement with something to pay and nothing holding its transfer can be late.
 */
export function isPayoutLate(
  statement: Pick<ReadStatement, 'status' | 'validatedAt' | 'payoutBlock' | 'payableMinor'>,
  delay: number | null,
  agency: AgencyToday,
): boolean | null {
  if (delay === null) return null;
  if (statement.status !== 'validated' || statement.validatedAt === null) return false;
  if (statement.payoutBlock !== null || statement.payableMinor <= 0) return false;
  return (
    workingDaysSince(calendarDayAt(new Date(statement.validatedAt), agency.timeZone), agency.today) > delay
  );
}

export const statementStateOf = (
  statement: ReadStatement,
  delay: number | null,
  agency: AgencyToday,
): StatementState => ({
  memberId: statement.memberId,
  status: statement.status,
  revision: statement.revision,
  computedAt: statement.computedAt,
  validatedAt: statement.validatedAt,
  paidAt: statement.paidAt,
  payoutBlocked:
    statement.status === 'validated' && statement.payableMinor > 0 && statement.payoutBlock !== null,
  payoutLate: isPayoutLate(statement, delay, agency),
});

/** Under two statements bringing an amount, a sum is one member's amount (decision A of 14/11). */
const TEAM_SUMS_FROM_STATEMENTS = 2;

/** A sum over the amounts, when two of them at least are not zero; else `null`, the amount of one member at most. */
function sumOfSeveral(amounts: readonly number[]): number | null {
  if (amounts.filter((amount) => amount !== 0).length < TEAM_SUMS_FROM_STATEMENTS) return null;
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

/**
 * The team's sums, for a person who sees every member (`view.reader.scope`, as the store read it under the policies);
 * `null` for one who sees only themselves. Each sum alone is `null` unless two statements bring it an amount.
 */
export function teamSumsFor(scope: TeamScope, statements: readonly ReadStatement[]): TeamSums | null {
  if (scope === 'self') return null;
  return {
    statements: statements.length,
    totalMinor: sumOfSeveral(statements.map((one) => one.totalMinor)),
    // Beside the total, the payable says what the total does not pay: the same rule holds for that difference.
    payableMinor:
      sumOfSeveral(statements.map((one) => one.totalMinor - one.payableMinor)) === null &&
      statements.some((one) => one.totalMinor !== one.payableMinor)
        ? null
        : sumOfSeveral(statements.map((one) => one.payableMinor)),
  };
}
