import type {
  CommissionStatement,
  CommissionStatementId,
  PayCommissionStatementBody,
} from '@nirvana/contracts';

import type { Actor, PayrollEntryStore } from '../domain/ports';

import type { PayrollReads } from './periods';

/** A member's bonuses, penalties and adjustments, and the payment of a statement (EQ-04, ADR 0032). */
export interface PayrollEntries extends Omit<PayrollEntryStore, 'pay'> {
  /** `POST /v1/payroll/statements/:id/pay`: the statement paid, as the owner reads it now. */
  pay(
    actor: Actor,
    statementId: CommissionStatementId,
    body: PayCommissionStatementBody,
  ): Promise<CommissionStatement>;
}

export function createPayrollEntries(store: PayrollEntryStore, reads: PayrollReads): PayrollEntries {
  return {
    createBonus: (actor, body) => store.createBonus(actor, body),
    cancelBonus: (actor, id) => store.cancelBonus(actor, id),
    createPenalty: (actor, body) => store.createPenalty(actor, body),
    cancelPenalty: (actor, id) => store.cancelPenalty(actor, id),
    createAdjustment: (actor, body) => store.createAdjustment(actor, body),
    async pay(actor, statementId, body) {
      const { period } = await store.pay(actor, statementId, body);
      const view = await reads.period(actor.userId, period);
      const statement = view.statements.find((one) => one.id === statementId);
      if (statement === undefined) throw new Error(`Statement ${statementId} is not read after its payment`);
      return statement;
    },
  };
}
