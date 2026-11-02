/**
 * The reconciliation of a contractor's transfers with his documents (EQ-06 lot 7a; ADR 0023 § Factures, « on descend au
 * transfert qui la solde » ; ADR 0036 : « le rapprochement impute les avoirs et les reports » ; ADR 0038), the pure rule.
 *
 * A carry-over always moves a statement's whole total (`carryOverOutMinor` is 0 or the total), and a statement is paid
 * only for its whole payable, never zero. So the debt of a document is carried, whole, from its statement to the next
 * through the carry-overs, until a statement ends it:
 *
 * - a paid one: its transfer pays the invoices (`paid`) and takes the credit notes off (`imputed`);
 * - a validated one whose cumulated total is zero: nothing is sent, and what the agency owed ends by compensation with
 *   what the contractor owed it (ADR 0038, art. 1347 du Code civil): its invoices and credit notes are `compensated`;
 * - a validated one whose total is below zero: the agency owes nothing any more, and its invoices are `compensated`;
 *   its credit notes are not used up, and the debt that is left goes on with the negative carry-over.
 *
 * A document is settled once, in full, by the first statement that ends its debt. Nothing here changes an amount: it
 * says which statement settled which document, for the journal's lettering and the due date's watch (lot 8).
 */

/** A statement of the contractor as the reconciliation reads it. */
export interface SettlementStatement {
  readonly id: string;
  readonly period: string;
  readonly status: 'draft' | 'validated' | 'paid';
  readonly totalMinor: number;
}

/** A carry-over: the statement whose total it moves, and the period of the statement that receives it. */
export interface SettlementCarryOver {
  readonly statementId: string;
  readonly toPeriod: string;
}

/** An issued document: the statement it was issued for (`null` for none), and whether it is settled already. */
export interface SettlementDocument {
  readonly id: string;
  readonly kind: 'invoice' | 'credit_note';
  readonly statementId: string | null;
  readonly settled: boolean;
}

/** How a statement ends a document's debt. */
export type SettlementKind = 'paid' | 'imputed' | 'compensated';

/** A settlement to write: the document, how its debt ended, and the statement that ended it. */
export interface Settlement {
  readonly documentId: string;
  readonly kind: SettlementKind;
  readonly statementId: string;
}

/** How `statement` ends the debt of a document of `kind`, or `null` when the debt goes on or waits. */
function endedBy(statement: SettlementStatement, kind: SettlementDocument['kind']): SettlementKind | null {
  if (statement.status === 'paid') return kind === 'invoice' ? 'paid' : 'imputed';
  if (statement.status !== 'validated') return null;
  if (statement.totalMinor === 0) return 'compensated';
  return kind === 'invoice' && statement.totalMinor < 0 ? 'compensated' : null;
}

/**
 * The settlements still to write for one contractor: each document not settled yet whose debt a statement has ended,
 * walking from its own statement through the carry-overs. A document whose walk stops on a statement still to be
 * paid, or on a carry-over whose next statement is not validated yet, waits; one issued after the statement that ends
 * its debt (a file that held it back) is settled once issued.
 */
export function settlementsDue(
  statements: readonly SettlementStatement[],
  carryOvers: readonly SettlementCarryOver[],
  documents: readonly SettlementDocument[],
): Settlement[] {
  const byId = new Map(statements.map((one) => [one.id, one]));
  const byPeriod = new Map(statements.map((one) => [one.period, one]));
  const carriedTo = new Map(carryOvers.map((one) => [one.statementId, one.toPeriod]));
  return documents
    .filter((document) => !document.settled)
    .flatMap((document): Settlement[] => {
      const seen = new Set<string>();
      let statement = document.statementId === null ? undefined : byId.get(document.statementId);
      while (statement !== undefined && !seen.has(statement.id)) {
        seen.add(statement.id);
        const kind = endedBy(statement, document.kind);
        if (kind !== null) return [{ documentId: document.id, kind, statementId: statement.id }];
        const toPeriod = carriedTo.get(statement.id);
        statement = toPeriod === undefined ? undefined : byPeriod.get(toPeriod);
      }
      return [];
    });
}

/**
 * The documents a transfer for `statementId` settles once it is recorded: what `settlementsDue` writes when that
 * statement is paid, the documents of its own period and those of the statements carried into it (ADR 0041 § 2).
 */
export function settledByTransfer(
  statementId: string,
  statements: readonly SettlementStatement[],
  carryOvers: readonly SettlementCarryOver[],
  documents: readonly SettlementDocument[],
): Settlement[] {
  const paid = statements.map((one) => (one.id === statementId ? { ...one, status: 'paid' as const } : one));
  return settlementsDue(paid, carryOvers, documents).filter((one) => one.statementId === statementId);
}
