import type { PayPeriod, UserId, UserRole } from '@impera/contracts';

import { PayReadForbidden } from '../domain/errors';
import { blockFor } from '../domain/period-blocks';
import type { PayrollReadStore } from '../domain/ports';
import { readsPay, statementStateOf, teamSumsFor, type PeriodState } from '../domain/statement-reads';

/**
 * The person a read is for, as the other door resolved them (`resolveActor`, ADR 0026 § 4): the same person the screen
 * would serve, never more. Their scope is read again by the database in the transaction (`withMember`).
 */
export interface PayStatementReader {
  readonly userId: UserId;
  readonly role: UserRole;
}

/**
 * The period for a door other than the routes (ADR 0026 § 1, the MCP's `commission_statements_list`): as
 * `GET /v1/payroll/periods/:period` reads it, under the same policies and as the same person, then cut to its state
 * (`statementStateOf`, decision A of 14/11: no amount of a member). A statement is a member's, not a creator's: this
 * read is never confined to a creator. Nothing here is written.
 */
export interface PayrollStatementReads {
  /** The period the reader may see: every member's statement for the owner and an active manager, else their own. */
  periodState(reader: PayStatementReader, period: PayPeriod): Promise<PeriodState>;
}

export function createPayrollStatementReads(
  store: Pick<PayrollReadStore, 'period'>,
  now: () => Date,
): PayrollStatementReads {
  return {
    periodState: async (reader, period) => {
      if (!readsPay(reader.role)) throw new PayReadForbidden();
      const view = await store.period(reader.userId, period);
      const at = now();
      const delay = view.settings.payoutDelayBusinessDays;
      const statements = view.statements.map(({ statement }) => statement);
      return {
        window: view.window,
        closedAt: view.closing?.closedAt ?? null,
        // As the screen gives it to the person: a member reads only themselves among the members it names.
        blocked: blockFor(view.blocked, view.reader),
        payoutDelayBusinessDays: delay,
        statements: statements
          .map((statement) => statementStateOf(statement, delay, at))
          .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0)),
        team: teamSumsFor(view.reader.scope, statements),
      };
    },
  };
}
