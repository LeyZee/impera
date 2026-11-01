import { describe, expect, it } from 'vitest';

import { das2Beneficiaries, purchaseJournal, type JournalDocument } from '../accounting';

/** The accountant's accounts; invented here, set in Réglages › Facturation. */
const ACCOUNTS = {
  expense: '622600',
  supplierPrefix: '401',
  vatDeductible: '445660',
  vatSelfAssessed: '445200',
};

const document = (patch: Partial<JournalDocument>): JournalDocument => ({
  kind: 'invoice',
  number: 'NORA-2026-0002',
  issuedOn: '2026-11-01',
  contractorName: 'Nora Vidal',
  contractorPrefix: 'NORA',
  totals: { exclVatMinor: 29_321, vatMinor: 0, inclVatMinor: 29_321, selfAssessedVatMinor: 5_864 },
  dueOn: '2026-11-16',
  payment: null,
  ...patch,
});

describe('the purchase journal (EQ-06)', () => {
  it('writes one row per invoice or credit note, by day of issue then number, on the accountant’s accounts', () => {
    const rows = purchaseJournal(
      [
        document({
          kind: 'credit_note',
          number: 'NORA-2026-0003',
          totals: { exclVatMinor: -2_000, vatMinor: 0, inclVatMinor: -2_000, selfAssessedVatMinor: -400 },
        }),
        document({}),
        document({
          number: 'THEO-2026-0001',
          issuedOn: '2026-10-16',
          contractorName: 'Théo Martin EI',
          contractorPrefix: 'THEO',
          totals: { exclVatMinor: 10_000, vatMinor: 2_000, inclVatMinor: 12_000, selfAssessedVatMinor: 0 },
          dueOn: '2026-10-31',
          payment: { paidOn: '2026-10-30', reference: 'VIR-OCT-2' },
        }),
      ],
      ACCOUNTS,
    );
    expect(rows.map((row) => row.number)).toEqual(['THEO-2026-0001', 'NORA-2026-0002', 'NORA-2026-0003']);
    expect(rows[0]).toEqual({
      kind: 'invoice',
      issuedOn: '2026-10-16',
      number: 'THEO-2026-0001',
      contractor: 'Théo Martin EI',
      supplierAccount: '401THEO',
      expenseAccount: '622600',
      exclVatMinor: 10_000,
      vatMinor: 2_000,
      vatAccount: '445660',
      selfAssessedVatMinor: 0,
      selfAssessedVatAccount: null,
      inclVatMinor: 12_000,
      dueOn: '2026-10-31',
      paidOn: '2026-10-30',
      paymentReference: 'VIR-OCT-2',
    });
    expect(rows[1]).toMatchObject({
      supplierAccount: '401NORA',
      vatAccount: null,
      selfAssessedVatMinor: 5_864,
      selfAssessedVatAccount: '445200',
      paidOn: null,
      paymentReference: null,
    });
    expect(rows[2]).toMatchObject({ kind: 'credit_note', exclVatMinor: -2_000, selfAssessedVatMinor: -400 });
  });
});

describe('the DAS2 of a year (EQ-06)', () => {
  it('declares what each contractor was paid in the calendar year, over 1 200 € only', () => {
    expect(
      das2Beneficiaries(2026, [
        { contractorId: 'theo', paidOn: '2026-03-02', sentMinor: 120_000 },
        { contractorId: 'nora', paidOn: '2025-12-31', sentMinor: 100_000 },
        { contractorId: 'nora', paidOn: '2026-01-15', sentMinor: 60_000 },
        { contractorId: 'nora', paidOn: '2026-12-31', sentMinor: 60_001 },
        { contractorId: 'basile', paidOn: '2027-01-01', sentMinor: 500_000 },
        { contractorId: 'lou', paidOn: '2026-06-30', sentMinor: 250_000 },
      ]),
    ).toEqual([
      { contractorId: 'lou', paidMinor: 250_000 },
      { contractorId: 'nora', paidMinor: 120_001 },
    ]);
    expect(das2Beneficiaries(2026, [])).toEqual([]);
  });
});
