import type {
  CommissionStatement,
  CommissionStatementId,
  CommissionStatementStatus,
  PayPeriod,
  TeamMemberId,
  UserRole,
} from '@impera/contracts';

/**
 * Who reads the statements (EQ-04, ADR 0026 § 1): the owner and the team's accounts, each with what their scope gives
 * them (`withMember`), never a creator. The routes ask it of the session (`requireRole('owner', 'operator')`); the
 * reads another door calls ask it here, so that the rule is the same for both.
 */
export const readsPay = (role: UserRole): boolean => role === 'owner' || role === 'operator';

/**
 * A statement as another door reads it (ADR 0105 § 3 and § 4, the MCP's `commission_statements_list`): its state and
 * the amounts of what it pays, never what would let a rate be worked out. Rates and presets stay closed to an agent:
 * the net is left out, since beside the commission their ratio is the member's rate. The commission is not given
 * either, though the total less the other amounts gives it back: without the net, it tells no rate. Nor the team share
 * (its base and its percentage), the tier (its threshold is a preset), the rules, the lines, nor anything of the
 * payment (method, reference) or of the contractor's file.
 */
export interface StatementAmounts {
  readonly id: CommissionStatementId;
  readonly memberId: TeamMemberId;
  readonly period: PayPeriod;
  readonly status: CommissionStatementStatus;
  readonly revision: number;
  readonly computedAt: string;
  readonly validatedAt: string | null;
  readonly paidAt: string | null;
  /** Every bonus counted: a tier's, the collective goal's and those given by hand, summed. */
  readonly bonusesMinor: number;
  readonly penaltiesMinor: number;
  readonly carryOversInMinor: number;
  readonly adjustmentsMinor: number;
  readonly totalMinor: number;
  /** What goes to the next period, below the minimum payout. */
  readonly carryOverOutMinor: number;
  /** What a final statement extinguishes (ADR 0072 § 4): its total below zero, zero everywhere else. */
  readonly writtenOffMinor: number;
  readonly payableMinor: number;
}

type ReadStatement = Pick<
  CommissionStatement,
  | 'id'
  | 'memberId'
  | 'window'
  | 'status'
  | 'revision'
  | 'computedAt'
  | 'validatedAt'
  | 'paidAt'
  | 'bonusesMinor'
  | 'penaltiesMinor'
  | 'carryOversInMinor'
  | 'adjustmentsMinor'
  | 'totalMinor'
  | 'carryOverOutMinor'
  | 'writtenOffMinor'
  | 'payableMinor'
>;

export const statementAmountsOf = (statement: ReadStatement): StatementAmounts => ({
  id: statement.id,
  memberId: statement.memberId,
  period: statement.window.period,
  status: statement.status,
  revision: statement.revision,
  computedAt: statement.computedAt,
  validatedAt: statement.validatedAt,
  paidAt: statement.paidAt,
  bonusesMinor: statement.bonusesMinor,
  penaltiesMinor: statement.penaltiesMinor,
  carryOversInMinor: statement.carryOversInMinor,
  adjustmentsMinor: statement.adjustmentsMinor,
  totalMinor: statement.totalMinor,
  carryOverOutMinor: statement.carryOverOutMinor,
  writtenOffMinor: statement.writtenOffMinor,
  payableMinor: statement.payableMinor,
});
