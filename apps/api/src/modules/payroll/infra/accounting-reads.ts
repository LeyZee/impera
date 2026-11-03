import { and, eq, inArray, schema, sql, type Transaction } from '@nirvana/db';

const { carryOvers, commissionStatements } = schema;

type StatementRow = typeof commissionStatements.$inferSelect;

/** A statement as the exports read it: its figures and its transfer. */
export type StatementForAccounting = Pick<
  StatementRow,
  'memberId' | 'id' | 'period' | 'status' | 'totalMinor' | 'validatedAt' | 'paidOn' | 'sentMinor'
> & { readonly reference: StatementRow['paymentReference'] };

/** A carry-over as the exports read it. */
export type CarryOverForAccounting = Pick<
  typeof carryOvers.$inferSelect,
  'memberId' | 'statementId' | 'toPeriod'
>;

/**
 * What the accountant's exports read of pay (ADR 0047 § 1, ARC-07), in the export's transaction (`withMember`, the
 * owner): the statements, their transfers and the carry-overs that link them. Pay alone reads its tables.
 */
export const payReadsForAccounting = {
  /** The members with a transfer recorded from `from` to `to`, both days included. */
  paidBetween: async (tx: Transaction, from: string, to: string): Promise<string[]> => {
    const rows = await tx
      .selectDistinct({ memberId: commissionStatements.memberId })
      .from(commissionStatements)
      .where(
        and(
          eq(commissionStatements.status, 'paid'),
          sql`${commissionStatements.paidOn} between ${from} and ${to}`,
        ),
      );
    return rows.map((row) => row.memberId);
  },

  /** Every statement of these members, whatever its period. */
  statementsOf: (tx: Transaction, memberIds: readonly string[]): Promise<StatementForAccounting[]> =>
    tx
      .select({
        memberId: commissionStatements.memberId,
        id: commissionStatements.id,
        period: commissionStatements.period,
        status: commissionStatements.status,
        totalMinor: commissionStatements.totalMinor,
        validatedAt: commissionStatements.validatedAt,
        paidOn: commissionStatements.paidOn,
        reference: commissionStatements.paymentReference,
        sentMinor: commissionStatements.sentMinor,
      })
      .from(commissionStatements)
      .where(inArray(commissionStatements.memberId, [...memberIds])),

  /** Every carry-over of these members: the statement it leaves, and the period it goes to. */
  carryOversOf: (tx: Transaction, memberIds: readonly string[]): Promise<CarryOverForAccounting[]> =>
    tx
      .select({
        memberId: carryOvers.memberId,
        statementId: carryOvers.statementId,
        toPeriod: carryOvers.toPeriod,
      })
      .from(carryOvers)
      .where(inArray(carryOvers.memberId, [...memberIds])),
};
