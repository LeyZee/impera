import { describe, expect, it } from 'vitest';

import { payoutDecision, type PayoutDocument, type PayoutFacts } from '../payouts';
import { settledByTransfer } from '../settlements';

/** A tax residence certificate of `year`, as the owner left it: accepted, refused, or still to check. */
const certificate = (
  id: string,
  issuedOn: string,
  review: PayoutDocument['review'] = { decision: 'accepted' },
): PayoutDocument => ({ id, kind: 'tax_residence', issuedOn, validUntil: null, review });

const facts = (patch: Partial<PayoutFacts<PayoutDocument>> = {}): PayoutFacts<PayoutDocument> => ({
  assignments: [{ regimeId: 'benin', from: '2026-01-01' }],
  regimes: [
    { id: 'benin', withholding: 'treaty_exempt' },
    { id: 'franchise', withholding: 'none' },
  ],
  statements: [{ id: 's1', period: '2026-11-01', status: 'validated', totalMinor: 9_000 }],
  carryOvers: [],
  documents: [{ id: 'i1', kind: 'invoice', statementId: 's1', settled: false, underTreaty: true }],
  certificates: [],
  ...patch,
});

describe('Équipe › Paie : le versement attend l’attestation de résidence de son année (ADR 0041)', () => {
  it('blocks a transfer under a treaty without a certificate of its year, missing or waiting for the check', () => {
    expect(payoutDecision(facts(), 's1', '2026-11-20')).toEqual({
      kind: 'blocked',
      reason: 'tax_residence_missing',
      year: '2026',
    });
    // Another year's does not count, nor a refused one; one still to check says so.
    const others = [
      certificate('c25', '2025-02-01'),
      certificate('c26-refused', '2026-02-01', { decision: 'refused', reason: 'Illisible' }),
    ];
    expect(payoutDecision(facts({ certificates: others }), 's1', '2026-11-20')).toMatchObject({
      reason: 'tax_residence_missing',
    });
    const waiting = [...others, certificate('c26', '2026-03-01', null)];
    expect(payoutDecision(facts({ certificates: waiting }), 's1', '2026-11-20')).toEqual({
      kind: 'blocked',
      reason: 'tax_residence_unverified',
      year: '2026',
    });
  });

  it('lets it go with the newest certificate of its year the owner accepted, which the record keeps', () => {
    const certificates = [
      certificate('c26', '2026-02-01'),
      certificate('c26-rescan', '2026-03-01'),
      certificate('c27', '2027-01-04'),
    ];
    expect(payoutDecision(facts({ certificates }), 's1', '2026-11-20')).toEqual({
      kind: 'covered',
      certificate: certificates[1],
    });
  });

  it('asks the year of the transfer, never the period’s, and no tolerance to 31 March', () => {
    // A December quinzaine paid in January: the certificate of the new year, that of the old one is not enough.
    const december = facts({
      statements: [{ id: 's1', period: '2026-12-16', status: 'validated', totalMinor: 9_000 }],
      certificates: [certificate('c26', '2026-02-01')],
    });
    expect(payoutDecision(december, 's1', '2027-01-05')).toEqual({
      kind: 'blocked',
      reason: 'tax_residence_missing',
      year: '2027',
    });
    expect(payoutDecision(december, 's1', '2026-12-31')).toMatchObject({ kind: 'covered' });
  });

  it('asks nothing of a contractor with no treaty, under no regime, or whose invoices it pays were issued without one', () => {
    const franchise = { assignments: [{ regimeId: 'franchise', from: '2026-01-01' }] };
    const noTreatyInvoice = [
      { id: 'i1', kind: 'invoice' as const, statementId: 's1', settled: false, underTreaty: false },
    ];
    expect(payoutDecision(facts({ ...franchise, documents: noTreatyInvoice }), 's1', '2026-11-20')).toEqual({
      kind: 'free',
    });
    expect(
      payoutDecision(facts({ assignments: [], documents: noTreatyInvoice }), 's1', '2026-11-20'),
    ).toEqual({
      kind: 'free',
    });
    // No invoice issued yet (a file that holds it): the regime of the day decides alone.
    expect(payoutDecision(facts({ ...franchise, documents: [] }), 's1', '2026-11-20')).toEqual({
      kind: 'free',
    });
  });

  it('asks it when the transfer pays an invoice issued under a treaty, its own or one carried into it, whatever the regime of the day', () => {
    // Under the treaty until October, then under a French regime: the carried quinzaine was invoiced under the treaty.
    const carried = facts({
      assignments: [
        { regimeId: 'benin', from: '2026-01-01' },
        { regimeId: 'franchise', from: '2026-11-01' },
      ],
      statements: [
        { id: 's0', period: '2026-10-16', status: 'validated', totalMinor: 900 },
        { id: 's1', period: '2026-11-01', status: 'validated', totalMinor: 9_900 },
      ],
      carryOvers: [{ statementId: 's0', toPeriod: '2026-11-01' }],
      documents: [
        { id: 'i0', kind: 'invoice', statementId: 's0', settled: false, underTreaty: true },
        { id: 'i1', kind: 'invoice', statementId: 's1', settled: false, underTreaty: false },
      ],
    });
    expect(payoutDecision(carried, 's1', '2026-11-20')).toMatchObject({ kind: 'blocked', year: '2026' });
    // Once that invoice is settled otherwise (compensated), the transfer pays none under the treaty.
    const settled = {
      ...carried,
      documents: carried.documents.map((one) => (one.id === 'i0' ? { ...one, settled: true } : one)),
    };
    expect(payoutDecision(settled, 's1', '2026-11-20')).toEqual({ kind: 'free' });
  });
});

describe('Équipe › Paie : ce qu’un virement solde (EQ-06 lot 7a)', () => {
  it('settles the documents of its statement and of those carried into it, as if it were paid', () => {
    const statements = [
      { id: 's0', period: '2026-10-16', status: 'validated' as const, totalMinor: 900 },
      { id: 's1', period: '2026-11-01', status: 'validated' as const, totalMinor: 9_900 },
      { id: 's2', period: '2026-11-16', status: 'draft' as const, totalMinor: 4_000 },
    ];
    const documents = [
      { id: 'i0', kind: 'invoice' as const, statementId: 's0', settled: false },
      { id: 'i1', kind: 'invoice' as const, statementId: 's1', settled: false },
      { id: 'c1', kind: 'credit_note' as const, statementId: 's1', settled: false },
      { id: 'i2', kind: 'invoice' as const, statementId: 's2', settled: false },
    ];
    expect(
      settledByTransfer('s1', statements, [{ statementId: 's0', toPeriod: '2026-11-01' }], documents),
    ).toEqual([
      { documentId: 'i0', kind: 'paid', statementId: 's1' },
      { documentId: 'i1', kind: 'paid', statementId: 's1' },
      { documentId: 'c1', kind: 'imputed', statementId: 's1' },
    ]);
  });
});
