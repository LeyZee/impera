import { describe, expect, it } from 'vitest';

import {
  payingStatement,
  settlementsDue,
  type SettlementCarryOver,
  type SettlementDocument,
  type SettlementStatement,
} from '../settlements';

const statement = (
  id: string,
  period: string,
  status: SettlementStatement['status'],
  totalMinor: number,
): SettlementStatement => ({ id, period, status, totalMinor });
const carry = (statementId: string, toPeriod: string): SettlementCarryOver => ({ statementId, toPeriod });
const invoice = (id: string, statementId: string | null, settled = false): SettlementDocument => ({
  id,
  kind: 'invoice',
  statementId,
  settled,
});
const creditNote = (id: string, statementId: string | null, settled = false): SettlementDocument => ({
  id,
  kind: 'credit_note',
  statementId,
  settled,
});

describe('Équipe › Factures : le rapprochement des versements (EQ-06 lot 7a)', () => {
  it('pays the invoices of a paid statement and imputes its credit notes on its transfer', () => {
    expect(
      settlementsDue(
        [statement('s1', '2026-09-01', 'paid', 9_000)],
        [],
        // A credit note its validation owes goes on an earlier invoice: the transfer of s1 deducts it.
        [invoice('i1', 's1'), creditNote('c1', 's1')],
      ),
    ).toEqual([
      { documentId: 'i1', kind: 'paid', statementId: 's1' },
      { documentId: 'c1', kind: 'imputed', statementId: 's1' },
    ]);
  });

  it('settles a carried statement by the transfer that receives its total, through each carry-over', () => {
    // Two small quinzaines carried (ADR 0038), the third paid: its transfer pays the three invoices.
    const statements = [
      statement('s1', '2026-09-01', 'validated', 900),
      statement('s2', '2026-09-16', 'validated', 1_300),
      statement('s3', '2026-10-01', 'paid', 1_400),
    ];
    const carryOvers = [carry('s1', '2026-09-16'), carry('s2', '2026-10-01')];
    expect(
      settlementsDue(statements, carryOvers, [invoice('i1', 's1'), invoice('i2', 's2'), invoice('i3', 's3')]),
    ).toEqual([
      { documentId: 'i1', kind: 'paid', statementId: 's3' },
      { documentId: 'i2', kind: 'paid', statementId: 's3' },
      { documentId: 'i3', kind: 'paid', statementId: 's3' },
    ]);
  });

  it('imputes the credit note of a quinzaine below zero on the transfer that takes its negative total', () => {
    // Refunds above sales: a credit note on an earlier, paid invoice, and the negative total carried.
    const statements = [
      statement('s1', '2026-09-01', 'paid', 5_000),
      statement('s2', '2026-09-16', 'validated', -3_000),
      statement('s3', '2026-10-01', 'paid', 5_000),
    ];
    expect(
      settlementsDue(
        statements,
        [carry('s2', '2026-10-01')],
        [invoice('i1', 's1', true), creditNote('c2', 's2'), invoice('i3', 's3')],
      ),
    ).toEqual([
      { documentId: 'c2', kind: 'imputed', statementId: 's3' },
      { documentId: 'i3', kind: 'paid', statementId: 's3' },
    ]);
  });

  it('compensates an invoice at a cumulated total below zero, and its credit note waits for the rest (ADR 0038)', () => {
    // 9 € carried, then 20 € of refunds: −11 €. The agency owes nothing any more for the 9 €; the contractor owes 11 €.
    const statements = [
      statement('s1', '2026-09-01', 'validated', 900),
      statement('s2', '2026-09-16', 'validated', -1_100),
      statement('s3', '2026-10-01', 'paid', 3_900),
    ];
    const documents = [invoice('i1', 's1'), creditNote('c2', 's2'), invoice('i3', 's3')];
    expect(settlementsDue(statements.slice(0, 2), [carry('s1', '2026-09-16')], documents)).toEqual([
      { documentId: 'i1', kind: 'compensated', statementId: 's2' },
    ]);
    // The next quinzaine takes the 11 € off its transfer: the credit note is imputed there.
    expect(
      settlementsDue(
        statements,
        [carry('s1', '2026-09-16'), carry('s2', '2026-10-01')],
        [invoice('i1', 's1', true), creditNote('c2', 's2'), invoice('i3', 's3')],
      ),
    ).toEqual([
      { documentId: 'c2', kind: 'imputed', statementId: 's3' },
      { documentId: 'i3', kind: 'paid', statementId: 's3' },
    ]);
  });

  it('compensates every document at a cumulated total of zero: nothing is sent, nothing is owed', () => {
    const statements = [
      statement('s1', '2026-09-01', 'validated', 900),
      statement('s2', '2026-09-16', 'validated', 0),
    ];
    expect(
      settlementsDue(statements, [carry('s1', '2026-09-16')], [invoice('i1', 's1'), creditNote('c2', 's2')]),
    ).toEqual([
      { documentId: 'i1', kind: 'compensated', statementId: 's2' },
      { documentId: 'c2', kind: 'compensated', statementId: 's2' },
    ]);
  });

  it('waits for a transfer still to come, for a next statement still a draft, and leaves a settled document', () => {
    const awaiting = [
      statement('s1', '2026-09-01', 'validated', 900),
      statement('s2', '2026-09-16', 'validated', 4_000),
    ];
    expect(
      settlementsDue(awaiting, [carry('s1', '2026-09-16')], [invoice('i1', 's1'), invoice('i2', 's2')]),
    ).toEqual([]);
    // A draft is no validation, even at zero; a carry-over whose next statement is not there yet waits too.
    const draft = [
      statement('s1', '2026-09-01', 'validated', -500),
      statement('s2', '2026-09-16', 'draft', 0),
    ];
    expect(settlementsDue(draft, [carry('s1', '2026-09-16')], [creditNote('c1', 's1')])).toEqual([]);
    expect(settlementsDue(draft.slice(0, 1), [carry('s1', '2026-09-16')], [creditNote('c1', 's1')])).toEqual(
      [],
    );
    expect(
      settlementsDue(
        [statement('s1', '2026-09-01', 'paid', 9_000)],
        [],
        [invoice('i1', 's1', true), creditNote('c0', null)],
      ),
    ).toEqual([]);
  });

  it('settles an invoice issued after its transfer, once it is issued (a file that held it back)', () => {
    const paid = [statement('s1', '2026-09-01', 'paid', 9_000)];
    expect(settlementsDue(paid, [], [])).toEqual([]);
    expect(settlementsDue(paid, [], [invoice('i1', 's1')])).toEqual([
      { documentId: 'i1', kind: 'paid', statementId: 's1' },
    ]);
  });
});

describe('Équipe › Factures : le relevé qui versera une facture (EQ-06 lot 8)', () => {
  it('finds the statement whose transfer pays an invoice, through each carry-over', () => {
    const statements = [
      statement('s1', '2026-09-01', 'validated', 900),
      statement('s2', '2026-09-16', 'validated', 1_300),
      statement('s3', '2026-10-01', 'validated', 2_200),
    ];
    const carryOvers = [carry('s1', '2026-09-16'), carry('s2', '2026-10-01')];
    expect(payingStatement(statements, carryOvers, invoice('i1', 's1'))).toEqual(statements[2]);
    expect(payingStatement(statements, carryOvers, invoice('i3', 's3'))).toEqual(statements[2]);
    // Not carried, its own statement pays it.
    expect(payingStatement(statements, [], invoice('i1', 's1'))).toEqual(statements[0]);
  });

  it('finds none while the walk stops before a validated statement with something to pay', () => {
    // The next statement is still a draft, or not there yet.
    const draft = [
      statement('s1', '2026-09-01', 'validated', 900),
      statement('s2', '2026-09-16', 'draft', 0),
    ];
    expect(payingStatement(draft, [carry('s1', '2026-09-16')], invoice('i1', 's1'))).toBeNull();
    expect(payingStatement(draft.slice(0, 1), [carry('s1', '2026-09-16')], invoice('i1', 's1'))).toBeNull();
    // A statement that ended the debt already: paid, or compensated at zero or below.
    for (const ended of [
      statement('s1', '2026-09-01', 'paid', 900),
      statement('s1', '2026-09-01', 'validated', 0),
      statement('s1', '2026-09-01', 'validated', -300),
    ])
      expect(payingStatement([ended], [], invoice('i1', 's1'))).toBeNull();
    // A statement unknown, or none.
    expect(payingStatement([], [], invoice('i1', 's1'))).toBeNull();
    expect(payingStatement(draft, [], creditNote('c0', null))).toBeNull();
    // A loop of carry-overs, which pay never writes, ends the walk.
    const loop = [
      statement('s1', '2026-09-01', 'validated', 900),
      statement('s2', '2026-09-16', 'validated', 900),
    ];
    expect(
      payingStatement(loop, [carry('s1', '2026-09-16'), carry('s2', '2026-09-01')], invoice('i1', 's1')),
    ).toBeNull();
  });
});
