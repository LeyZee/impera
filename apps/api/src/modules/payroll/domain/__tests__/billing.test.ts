import { describe, expect, it } from 'vitest';

import {
  assertRegimeChange,
  documentState,
  documentValidUntil,
  issueDecision,
  regimeOn,
  type BillingRegime,
  type IssueFacts,
} from '../billing';

/** Regimes as the owner would set them; their mentions are data, here short invented ones. */
const ABROAD: BillingRegime = {
  id: 'abroad',
  vat: { treatment: 'reverse_charge', rateBps: 2_000 },
  withholding: 'treaty_exempt',
  mentions: ['Autofacturation', 'Autoliquidation'],
  documents: ['tax_residence'],
  taxIdRequired: false,
  validatedOn: '2026-10-20',
};
const FRANCHISE: BillingRegime = {
  id: 'franchise',
  vat: { treatment: 'exempt' },
  withholding: 'none',
  mentions: ['Autofacturation', 'TVA non applicable, art. 293 B du CGI'],
  documents: ['urssaf_vigilance'],
  taxIdRequired: true,
  validatedOn: '2026-10-20',
};

const facts = (patch: Partial<IssueFacts> = {}): IssueFacts => ({
  day: '2026-11-02',
  mandate: { acceptedVersion: 1, currentVersion: 1 },
  assignments: [{ regimeId: 'abroad', from: '2026-10-01' }],
  regimes: [ABROAD, FRANCHISE],
  identity: { legalName: 'Théo Martin', address: '12 rue des Lilas, Cotonou', country: 'BJ', taxId: null },
  prefix: 'THEO',
  agency: {
    legalName: 'Agence Exemple SAS',
    address: '1 place Inventée, 69000 Lyon',
    siren: '123456789',
    vatNumber: 'FR12123456789',
  },
  documents: [{ kind: 'tax_residence', issuedOn: '2026-03-10', validUntil: null }],
  exclVatMinor: 32_515,
  ...patch,
});

describe('a contractor’s billing regime (EQ-06)', () => {
  it('is the latest one started on the day, none before the first', () => {
    const assignments = [
      { regimeId: 'franchise', from: '2026-01-01' },
      { regimeId: 'vat', from: '2026-11-16' },
    ];
    expect(regimeOn(assignments, '2025-12-31')).toBeNull();
    expect(regimeOn(assignments, '2026-11-15')?.regimeId).toBe('franchise');
    expect(regimeOn(assignments, '2026-11-16')?.regimeId).toBe('vat');
  });

  it('changes from today at the earliest and after the last change, never backwards', () => {
    const assignments = [{ regimeId: 'franchise', from: '2026-01-01' }];
    expect(() => {
      assertRegimeChange(assignments, { regimeId: 'vat', from: '2026-11-02' }, '2026-11-02');
    }).not.toThrow();
    for (const from of ['2026-11-01', '2025-12-31']) {
      expect(() => {
        assertRegimeChange(assignments, { regimeId: 'vat', from }, '2026-11-02');
      }).toThrow(expect.objectContaining({ code: 'billing_regime_backdated_unprocessable' }));
    }
    expect(() => {
      assertRegimeChange(
        [{ regimeId: 'franchise', from: '2026-12-01' }],
        { regimeId: 'vat', from: '2026-12-01' },
        '2026-11-02',
      );
    }).toThrow(expect.objectContaining({ code: 'billing_regime_backdated_unprocessable' }));
  });
});

describe('a contractor’s documents (EQ-06)', () => {
  it('hold a year for residence and six months for vigilance, unless they state their end', () => {
    expect(documentValidUntil({ kind: 'tax_residence', issuedOn: '2026-03-10', validUntil: null })).toBe(
      '2027-03-09',
    );
    expect(documentValidUntil({ kind: 'urssaf_vigilance', issuedOn: '2026-05-15', validUntil: null })).toBe(
      '2026-11-14',
    );
    // The 31st of August plus six months ends with February.
    expect(documentValidUntil({ kind: 'urssaf_vigilance', issuedOn: '2026-08-31', validUntil: null })).toBe(
      '2027-02-27',
    );
    expect(
      documentValidUntil({ kind: 'tax_residence', issuedOn: '2026-03-10', validUntil: '2026-12-31' }),
    ).toBe('2026-12-31');
  });

  it('expire the day after their last day, and call for renewal from the owner’s delay before', () => {
    const vigilance = { kind: 'urssaf_vigilance', issuedOn: '2026-05-15', validUntil: null } as const;
    // Fifteen days before the 14th of November is the 30th of October.
    expect(documentState(vigilance, '2026-10-29', 15)).toBe('valid');
    expect(documentState(vigilance, '2026-10-30', 15)).toBe('expiring');
    expect(documentState(vigilance, '2026-11-14', 15)).toBe('expiring');
    expect(documentState(vigilance, '2026-11-15', 15)).toBe('expired');
  });
});

describe('whether a validated statement issues its invoice (EQ-06)', () => {
  it('issues under the regime of the day, with no warning when the file is complete', () => {
    expect(issueDecision(facts())).toEqual({ kind: 'issue', regime: ABROAD, warnings: [] });
  });

  it('issues nothing without a mandate, a regime, a validated regime or the identity the mentions need', () => {
    expect(issueDecision(facts({ mandate: { acceptedVersion: null, currentVersion: 2 } }))).toMatchObject({
      kind: 'none',
      reason: 'no_mandate',
    });
    expect(issueDecision(facts({ assignments: [] }))).toMatchObject({ kind: 'none', reason: 'no_regime' });
    expect(issueDecision(facts({ assignments: [{ regimeId: 'gone', from: '2026-10-01' }] }))).toMatchObject({
      reason: 'no_regime',
    });
    expect(issueDecision(facts({ regimes: [{ ...ABROAD, validatedOn: null }, FRANCHISE] }))).toMatchObject({
      kind: 'none',
      reason: 'regime_not_validated',
    });
    // Validated after the day of the validation: not yet.
    expect(
      issueDecision(facts({ regimes: [{ ...ABROAD, validatedOn: '2026-11-03' }, FRANCHISE] })),
    ).toMatchObject({ reason: 'regime_not_validated' });
    expect(issueDecision(facts({ identity: null }))).toMatchObject({ reason: 'identity_incomplete' });
    expect(
      issueDecision(
        facts({ identity: { legalName: 'Théo Martin', address: '  ', country: 'BJ', taxId: null } }),
      ),
    ).toMatchObject({ reason: 'identity_incomplete' });
    // In France, the SIREN is a mention: without it, no invoice.
    expect(
      issueDecision(
        facts({
          assignments: [{ regimeId: 'franchise', from: '2026-10-01' }],
          identity: {
            legalName: 'Basile Roux EI',
            address: '3 place Bellecour, Lyon',
            country: 'FR',
            taxId: null,
          },
          documents: [{ kind: 'urssaf_vigilance', issuedOn: '2026-09-01', validUntil: null }],
        }),
      ),
    ).toMatchObject({ reason: 'identity_incomplete' });
  });

  it('issues nothing without the contractor’s prefix or the agency’s identity, both the owner’s settings', () => {
    expect(issueDecision(facts({ prefix: null }))).toMatchObject({ kind: 'none', reason: 'prefix_missing' });
    expect(issueDecision(facts({ agency: null }))).toMatchObject({ kind: 'none', reason: 'agency_missing' });
  });

  it('issues nothing for a period that brings nothing, and has nothing to tell the owner then', () => {
    expect(issueDecision(facts({ exclVatMinor: 0 }))).toMatchObject({ reason: 'nothing_to_invoice' });
    expect(issueDecision(facts({ exclVatMinor: -1_240 }))).toMatchObject({ reason: 'nothing_to_invoice' });
    // Nothing to invoice comes first: a member without a mandate who earned nothing is not a reason to alert.
    expect(
      issueDecision(
        facts({ exclVatMinor: 0, mandate: { acceptedVersion: null, currentVersion: 1 }, prefix: null }),
      ),
    ).toMatchObject({ reason: 'nothing_to_invoice' });
  });

  it('issues with amber warnings for documents missing or out of date, and an older mandate', () => {
    expect(
      issueDecision(
        facts({
          documents: [{ kind: 'tax_residence', issuedOn: '2025-10-15', validUntil: null }],
          mandate: { acceptedVersion: 1, currentVersion: 2 },
        }),
      ),
    ).toEqual({
      kind: 'issue',
      regime: ABROAD,
      warnings: [
        { code: 'document_expired', kind: 'tax_residence', until: '2026-10-14' },
        { code: 'mandate_outdated', accepted: 1, current: 2 },
      ],
    });
    // The newest document counts: a renewal ends the warning.
    expect(
      issueDecision(
        facts({
          documents: [
            { kind: 'tax_residence', issuedOn: '2025-10-15', validUntil: null },
            { kind: 'tax_residence', issuedOn: '2026-10-20', validUntil: null },
          ],
        }),
      ).warnings,
    ).toEqual([]);
    expect(issueDecision(facts({ documents: [] })).warnings).toEqual([
      { code: 'document_missing', kind: 'tax_residence' },
    ]);
    // A statement with no invoice still says what is missing in the file.
    expect(
      issueDecision(facts({ documents: [], mandate: { acceptedVersion: null, currentVersion: 1 } })),
    ).toEqual({
      kind: 'none',
      reason: 'no_mandate',
      warnings: [{ code: 'document_missing', kind: 'tax_residence' }],
    });
  });
});
