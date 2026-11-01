import type {
  CommissionStatement,
  CommissionStatementId,
  ValidateCommissionStatementBody,
} from '@nirvana/contracts';

import { CommissionStatementChanged } from '../domain/errors';
import type { Actor, PayrollValidationStore } from '../domain/ports';

import type { PayrollReads } from './periods';

export interface PayrollValidation {
  /**
   * `POST /v1/payroll/statements/:id/validate` (EQ-04, ADR 0032): the statement validated, as its validator reads it
   * now. A statement that changed under the reader is computed again, so that the next read shows what to validate.
   */
  validate(
    actor: Actor,
    statementId: CommissionStatementId,
    body: ValidateCommissionStatementBody,
  ): Promise<CommissionStatement>;
}

export function createPayrollValidation(
  store: PayrollValidationStore,
  reads: PayrollReads,
): PayrollValidation {
  return {
    async validate(actor, statementId, body) {
      let validated: Awaited<ReturnType<PayrollValidationStore['validate']>>;
      try {
        validated = await store.validate(actor, statementId, body.revision);
      } catch (error) {
        // The refused transaction wrote nothing, not even a job: the recalculation is asked for on its own.
        if (error instanceof CommissionStatementChanged)
          await store.enqueueRecalculation(actor, error.period);
        throw error;
      }
      // Read after the commit: if this read fails, the client gets a 500 though the statement is validated, and a
      // replay answers `commission_statement_status_conflict`, which is true. The next read of the period shows it.
      const view = await reads.period(actor.userId, validated.period);
      const statement = view.statements.find((one) => one.id === statementId);
      if (statement === undefined)
        throw new Error(`Statement ${statementId} is not read after its validation`);
      return statement;
    },
  };
}
