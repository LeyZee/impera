import { and, eq, inArray, schema, sql, type Transaction } from '@impera/db';

import { payReadsForAccounting } from './accounting-reads';

const { commissionStatementLines, commissionStatements, payAdjustments, platformAccounts } = schema;

type StatementRow = typeof commissionStatements.$inferSelect;
type LineRow = typeof commissionStatementLines.$inferSelect;

/** A statement as the invoices read it: the whole row, which an issue copies figure by figure. */
export type StatementForInvoicing = StatementRow;

/** A line of a statement as an invoice sums it per account. */
export type LineForInvoicing = Pick<LineRow, 'platformAccountId' | 'netMinor' | 'commissionMinor'>;

/** A line of a statement as the annex of an invoice's PDF prints it, with the name of its account. */
export type AnnexLineForInvoicing = Pick<
  LineRow,
  | 'currency'
  | 'rateMicros'
  | 'grossMinor'
  | 'grossEurMinor'
  | 'exclVatMinor'
  | 'netMinor'
  | 'commissionMinor'
  | 'base'
> & {
  readonly handle: string;
  readonly platform: string;
};

/** What the annex of an invoice's PDF reads of its statement. */
export type AnnexForInvoicing = Pick<StatementRow, 'revision' | 'rules' | 'validatedAt'>;

/** An adjustment that corrected a contested document, as `correctionReplayed` compares them. */
export type CorrectionForInvoicing = Pick<typeof payAdjustments.$inferSelect, 'amountMinor' | 'reason'>;

/** The `in (…)` of a list of ids, which Drizzle would otherwise expand as values without their list. */
const idsIn = (ids: readonly string[]): ReturnType<typeof sql> =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;

/**
 * What the invoices read of pay (ADR 0047 § 1, ARC-07), in their caller's transaction (the job's `withAdmin`, or the
 * policies of `withMember`): the statements they issue from and settle, their lines, the adjustments of a contest and
 * the carry-overs. Pay alone reads its tables.
 */
export const payReadsForInvoicing = {
  /** A statement, whole, `undefined` when there is none. */
  statementOf: async (tx: Transaction, statementId: string): Promise<StatementForInvoicing | undefined> => {
    const [row] = await tx
      .select()
      .from(commissionStatements)
      .where(eq(commissionStatements.id, statementId));
    return row;
  },

  /** The member a statement is for, `null` when there is none. */
  memberOfStatement: async (tx: Transaction, statementId: string): Promise<string | null> => {
    const [row] = await tx
      .select({ memberId: commissionStatements.memberId })
      .from(commissionStatements)
      .where(eq(commissionStatements.id, statementId));
    return row?.memberId ?? null;
  },

  /** The lines of a statement's revision, by account. */
  linesOf: (tx: Transaction, statementId: string, revision: number): Promise<LineForInvoicing[]> =>
    tx
      .select({
        platformAccountId: commissionStatementLines.platformAccountId,
        netMinor: commissionStatementLines.netMinor,
        commissionMinor: commissionStatementLines.commissionMinor,
      })
      .from(commissionStatementLines)
      .where(
        and(
          eq(commissionStatementLines.statementId, statementId),
          eq(commissionStatementLines.revision, revision),
        ),
      )
      .orderBy(commissionStatementLines.platformAccountId),

  /** What the annex reads of a statement, `undefined` when there is none. */
  annexOf: async (tx: Transaction, statementId: string): Promise<AnnexForInvoicing | undefined> => {
    const [row] = await tx
      .select({
        revision: commissionStatements.revision,
        rules: commissionStatements.rules,
        validatedAt: commissionStatements.validatedAt,
      })
      .from(commissionStatements)
      .where(eq(commissionStatements.id, statementId));
    return row;
  },

  /** The lines of a statement's revision with their accounts, in the annex's order. */
  annexLinesOf: (tx: Transaction, statementId: string, revision: number): Promise<AnnexLineForInvoicing[]> =>
    tx
      .select({
        handle: platformAccounts.handle,
        platform: platformAccounts.platform,
        currency: commissionStatementLines.currency,
        rateMicros: commissionStatementLines.rateMicros,
        grossMinor: commissionStatementLines.grossMinor,
        grossEurMinor: commissionStatementLines.grossEurMinor,
        exclVatMinor: commissionStatementLines.exclVatMinor,
        netMinor: commissionStatementLines.netMinor,
        commissionMinor: commissionStatementLines.commissionMinor,
        base: commissionStatementLines.base,
      })
      .from(commissionStatementLines)
      .innerJoin(platformAccounts, eq(platformAccounts.id, commissionStatementLines.platformAccountId))
      .where(
        and(
          eq(commissionStatementLines.statementId, statementId),
          eq(commissionStatementLines.revision, revision),
        ),
      )
      .orderBy(
        platformAccounts.handle,
        platformAccounts.platform,
        commissionStatementLines.currency,
        commissionStatementLines.vatBps,
        commissionStatementLines.platformFeeBps,
        // An account's two bases in one period are two rows, its reports' first (CRM-03).
        commissionStatementLines.base,
      ),

  /** The period of each of these statements. */
  periodsOf: async (
    tx: Transaction,
    statementIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> => {
    if (statementIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: commissionStatements.id, period: commissionStatements.period })
      .from(commissionStatements)
      .where(inArray(commissionStatements.id, [...statementIds]));
    return new Map(rows.map((row) => [row.id, row.period]));
  },

  /** The day of transfer of each of these statements, `null` for one not paid. */
  paidOnOf: async (
    tx: Transaction,
    statementIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> => {
    if (statementIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: commissionStatements.id, paidOn: commissionStatements.paidOn })
      .from(commissionStatements)
      .where(inArray(commissionStatements.id, [...statementIds]));
    return new Map(rows.map((row) => [row.id, row.paidOn]));
  },

  /** The statements of a period, of one member or of every member. */
  idsOfPeriod: async (tx: Transaction, period: string, memberId?: string): Promise<string[]> => {
    const rows = await tx
      .select({ id: commissionStatements.id })
      .from(commissionStatements)
      .where(
        and(
          eq(commissionStatements.period, period),
          memberId === undefined ? undefined : eq(commissionStatements.memberId, memberId),
        ),
      );
    return rows.map((row) => row.id);
  },

  /** A member's statement of a period, `null` when there is none (one per member and period). */
  statementIdOf: async (tx: Transaction, memberId: string, period: string): Promise<string | null> => {
    const [row] = await tx
      .select({ id: commissionStatements.id })
      .from(commissionStatements)
      .where(and(eq(commissionStatements.memberId, memberId), eq(commissionStatements.period, period)));
    return row?.id ?? null;
  },

  /** Among these statements, the validated or paid ones (of one member, or of every one for `null`), in period order. */
  issuedAmong: async (
    tx: Transaction,
    statementIds: readonly string[],
    memberId: string | null,
  ): Promise<string[]> => {
    if (statementIds.length === 0) return [];
    const rows = await tx
      .select({ id: commissionStatements.id })
      .from(commissionStatements)
      .where(
        and(
          inArray(commissionStatements.status, ['validated', 'paid']),
          memberId === null ? undefined : eq(commissionStatements.memberId, memberId),
          sql`${commissionStatements.id}::text in ${idsIn(statementIds)}`,
        ),
      )
      .orderBy(commissionStatements.period, commissionStatements.id);
    return rows.map((row) => row.id);
  },

  /** The document whose upheld contest each of these adjustments corrects, `null` for none. */
  contestsOf: async (
    tx: Transaction,
    adjustmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> => {
    if (adjustmentIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: payAdjustments.id, contestedInvoiceId: payAdjustments.contestedInvoiceId })
      .from(payAdjustments)
      .where(inArray(payAdjustments.id, [...adjustmentIds]));
    return new Map(rows.map((row) => [row.id, row.contestedInvoiceId]));
  },

  /** The adjustments that corrected a document's contest, negative first. */
  correctionOf: (tx: Transaction, invoiceId: string): Promise<CorrectionForInvoicing[]> =>
    tx
      .select({ amountMinor: payAdjustments.amountMinor, reason: payAdjustments.reason })
      .from(payAdjustments)
      .where(eq(payAdjustments.contestedInvoiceId, invoiceId))
      .orderBy(payAdjustments.amountMinor, payAdjustments.id),

  /** Every statement of these members, as the reconciliation of their documents walks them. */
  statementsOf: payReadsForAccounting.statementsOf,

  /** Every carry-over of these members. */
  carryOversOf: payReadsForAccounting.carryOversOf,
};
