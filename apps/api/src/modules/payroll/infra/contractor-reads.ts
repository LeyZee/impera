import { sql } from '@impera/db';
import { z } from 'zod';

import type { ContractorPayReads } from '../../contractors';

const PaidSchema = z.array(z.object({ id: z.string(), paid_on: z.string() }));

/**
 * What the contractors' file reads of pay (ADR 0047 § 1, ARC-07), in the file's transaction: the day each statement
 * was paid, for the certificate a transfer relied on (`payroll.lock_payout_certificate`). Pay alone reads its tables.
 */
export const payReadsForContractors: ContractorPayReads = {
  paidOn: async (tx, statementIds) => {
    if (statementIds.length === 0) return new Map();
    const found = await tx.execute(sql`
      select id::text as id, paid_on::text as paid_on
      from commission_statements
      where status = 'paid' and id::text in (${sql.join(
        statementIds.map((id) => sql`${id}`),
        sql`, `,
      )})`);
    return new Map(PaidSchema.parse(found.rows).map((row) => [row.id, row.paid_on]));
  },
};
