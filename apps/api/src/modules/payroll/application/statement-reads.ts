import type { PayPeriod, UserId, UserRole } from '@impera/contracts';

import { PayReadForbidden } from '../domain/errors';
import type { PayrollReadStore } from '../domain/ports';
import { readsPay, statementAmountsOf, type StatementAmounts } from '../domain/statement-reads';

/**
 * The person a read is for, as the other door resolved them (`resolveActor`, ADR 0026 § 4): the same person the screen
 * would serve, never more. Their scope is read again by the database in the transaction (`withMember`).
 */
export interface PayStatementReader {
  readonly userId: UserId;
  readonly role: UserRole;
}

/**
 * The statements for a door other than the routes (ADR 0026 § 1, the MCP's `commission_statements_list`): the period
 * as `GET /v1/payroll/periods/:period` reads it, under the same policies and as the same person, then cut to what may
 * leave without telling a rate (`statementAmountsOf`). A statement is a member's, not a creator's: this read is never
 * confined to a creator. Nothing here is written.
 */
export interface PayrollStatementReads {
  /** The period's statements the reader may see: every member's for the owner and an active manager, else their own. */
  statements(reader: PayStatementReader, period: PayPeriod): Promise<StatementAmounts[]>;
}

export function createPayrollStatementReads(store: Pick<PayrollReadStore, 'period'>): PayrollStatementReads {
  return {
    statements: async (reader, period) => {
      if (!readsPay(reader.role)) throw new PayReadForbidden();
      const view = await store.period(reader.userId, period);
      return view.statements
        .map(({ statement }) => statementAmountsOf(statement))
        .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
    },
  };
}
