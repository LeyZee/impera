import { PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertRegimeChange,
  documentState,
  documentValidUntil,
  issueDecision,
  regimeOn,
  taxResidenceFor,
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

/** The second fortnight of October 2026, which a certificate of 2026 covers. */
const OCTOBER = PayPeriodSchema.parse('2026-10-16');
/** A tax residence certificate of 2026, accepted by the owner. */
const RESIDENCE_2026 = {
  kind: 'tax_residence',
  issuedOn: '2026-03-10',
  validUntil: null,
  review: { decision: 'accepted' },
} as const;

const facts = (patch: Partial<IssueFacts> = {}): IssueFacts => ({
  day: '2026-11-02',
  period: OCTOBER,
  mandate: { acceptedVersion: 1, currentVersion: 1 },
  assignments: [{ regimeId: 'abroad', from: '2026-10-01' }],
  regimes: [ABROAD, FRANCHISE],
  identity: {
    legalName: 'Théo Martin',
    address: '12 rue des Lilas, Cotonou',
    country: 'BJ',
    taxId: null,
    businessId: null,
    vatNumber: null,
    individualEntrepreneur: false,
    legalForm: null,
    shareCapitalMinor: null,
    rcsCity: null,
  },
  identityVerified: true,
  prefix: 'THEO',
  agency: {
    legalName: 'Agence Exemple SAS',
    address: '1 place Inventée, 69000 Lyon',
    siren: '123456789',
    vatNumber: 'FR12123456789',
  },
  documents: [RESIDENCE_2026],
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
  it('hold the calendar year for residence and six months for vigilance, unless they state their end', () => {
    // « ok année civile »: the Beninese tax office issues it for the year, French doctrine reads it so.
    expect(documentValidUntil({ kind: 'tax_residence', issuedOn: '2026-03-10', validUntil: null })).toBe(
      '2026-12-31',
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
    // Complete but not checked by the owner as it stands (never checked, or a change of identity cleared it).
    expect(issueDecision(facts({ identityVerified: false }))).toMatchObject({
      kind: 'none',
      reason: 'identity_unverified',
    });
    // An incomplete file says what it lacks first: a check would not fill it.
    expect(issueDecision(facts({ identity: null, identityVerified: false }))).toMatchObject({
      reason: 'identity_incomplete',
    });
    expect(
      issueDecision(
        facts({
          identity: {
            legalName: 'Théo Martin',
            address: '  ',
            country: 'BJ',
            taxId: null,
            businessId: null,
            vatNumber: null,
            individualEntrepreneur: false,
            legalForm: null,
            shareCapitalMinor: null,
            rcsCity: null,
          },
        }),
      ),
    ).toMatchObject({ reason: 'identity_incomplete' });
    // In France, the SIREN or SIRET is a mention (art. 242 nonies A, annexe II CGI): without it, no invoice.
    const french = (patch: Partial<NonNullable<IssueFacts['identity']>>): IssueFacts =>
      facts({
        assignments: [{ regimeId: 'franchise', from: '2026-10-01' }],
        identity: {
          legalName: 'Basile Roux',
          address: '3 place Bellecour, Lyon',
          country: 'FR',
          taxId: '12345678900011',
          businessId: null,
          vatNumber: null,
          individualEntrepreneur: true,
          legalForm: null,
          shareCapitalMinor: null,
          rcsCity: null,
          ...patch,
        },
        documents: [{ kind: 'urssaf_vigilance', issuedOn: '2026-09-01', validUntil: null, review: null }],
      });
    expect(issueDecision(french({}))).toMatchObject({ reason: 'identity_incomplete' });
    expect(issueDecision(french({ businessId: '  ' }))).toMatchObject({ reason: 'identity_incomplete' });
    expect(issueDecision(french({ businessId: '12345678900011' }))).toMatchObject({ kind: 'issue' });
  });

  it('asks a French company its legal form, share capital and register, never a person or one abroad', () => {
    // Art. R123-237 of the Code de commerce, the accountant's answers of 01/11: a company prints all three.
    const company = (patch: Partial<NonNullable<IssueFacts['identity']>>): IssueFacts =>
      facts({
        assignments: [{ regimeId: 'franchise', from: '2026-10-01' }],
        identity: {
          legalName: 'Atelier Roux',
          address: '3 place Bellecour, Lyon',
          country: 'FR',
          taxId: '123456789',
          businessId: '123456789',
          vatNumber: null,
          individualEntrepreneur: false,
          legalForm: 'SARL',
          shareCapitalMinor: 1_000_000,
          rcsCity: 'Lyon',
          ...patch,
        },
        documents: [{ kind: 'urssaf_vigilance', issuedOn: '2026-09-01', validUntil: null, review: null }],
      });
    expect(issueDecision(company({}))).toMatchObject({ kind: 'issue' });
    expect(issueDecision(company({ legalForm: null }))).toMatchObject({ reason: 'identity_incomplete' });
    expect(issueDecision(company({ legalForm: ' ' }))).toMatchObject({ reason: 'identity_incomplete' });
    expect(issueDecision(company({ shareCapitalMinor: null }))).toMatchObject({
      reason: 'identity_incomplete',
    });
    expect(issueDecision(company({ rcsCity: null }))).toMatchObject({ reason: 'identity_incomplete' });
    // An individual entrepreneur is a person: « EI » after the name, no form, capital or register.
    expect(
      issueDecision(
        company({ individualEntrepreneur: true, legalForm: null, shareCapitalMinor: null, rcsCity: null }),
      ),
    ).toMatchObject({ kind: 'issue' });
    // Abroad, the French register does not apply.
    expect(
      issueDecision(
        facts({
          identity: {
            legalName: 'Atelier Houénou',
            address: '12 rue des Lilas, Cotonou',
            country: 'BJ',
            taxId: null,
            businessId: null,
            vatNumber: null,
            individualEntrepreneur: false,
            legalForm: null,
            shareCapitalMinor: null,
            rcsCity: null,
          },
        }),
      ),
    ).toMatchObject({ kind: 'issue' });
  });

  it('asks the VAT number of a contractor who charges VAT, and no SIREN of one established abroad', () => {
    const charged: BillingRegime = {
      ...ABROAD,
      id: 'charged',
      vat: { treatment: 'charged', rateBps: 2000 },
    };
    const french = (vatNumber: string | null): IssueFacts =>
      facts({
        assignments: [{ regimeId: 'charged', from: '2026-10-01' }],
        regimes: [charged],
        identity: {
          legalName: 'Basile Roux',
          address: '3 place Bellecour, Lyon',
          country: 'FR',
          taxId: null,
          businessId: '12345678900011',
          vatNumber,
          individualEntrepreneur: false,
          legalForm: 'SAS',
          shareCapitalMinor: 100_000,
          rcsCity: 'Lyon',
        },
      });
    expect(issueDecision(french(null))).toMatchObject({ reason: 'identity_incomplete' });
    expect(issueDecision(french('FR12123456789'))).toMatchObject({ kind: 'issue' });
    // Abroad, no SIREN exists: the regime's own tax identifier is what it asks.
    expect(issueDecision(facts())).toMatchObject({ kind: 'issue' });
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
    const vigilance = (issuedOn: string) =>
      ({ kind: 'urssaf_vigilance', issuedOn, validUntil: null, review: null }) as const;
    const french = (patch: Partial<IssueFacts>): IssueFacts =>
      facts({
        assignments: [{ regimeId: 'franchise', from: '2026-10-01' }],
        identity: {
          legalName: 'Basile Roux',
          address: '3 place Bellecour, Lyon',
          country: 'FR',
          taxId: '12345678900011',
          businessId: '12345678900011',
          vatNumber: null,
          individualEntrepreneur: true,
          legalForm: null,
          shareCapitalMinor: null,
          rcsCity: null,
        },
        ...patch,
      });
    expect(
      issueDecision(
        french({ documents: [vigilance('2026-04-15')], mandate: { acceptedVersion: 1, currentVersion: 2 } }),
      ),
    ).toEqual({
      kind: 'issue',
      regime: FRANCHISE,
      warnings: [
        { code: 'document_expired', kind: 'urssaf_vigilance', until: '2026-10-14' },
        { code: 'mandate_outdated', accepted: 1, current: 2 },
      ],
    });
    // The newest document counts: a renewal ends the warning; a refused one counts as none.
    expect(
      issueDecision(french({ documents: [vigilance('2026-04-15'), vigilance('2026-10-20')] })).warnings,
    ).toEqual([]);
    expect(
      issueDecision(
        french({
          documents: [
            vigilance('2026-04-15'),
            { ...vigilance('2026-10-20'), review: { decision: 'refused', reason: 'Illisible.' } },
          ],
        }),
      ).warnings,
    ).toEqual([{ code: 'document_expired', kind: 'urssaf_vigilance', until: '2026-10-14' }]);
    expect(issueDecision(french({ documents: [] })).warnings).toEqual([
      { code: 'document_missing', kind: 'urssaf_vigilance' },
    ]);
    // A statement with no invoice still says what is missing in the file.
    expect(
      issueDecision(french({ documents: [], mandate: { acceptedVersion: null, currentVersion: 1 } })),
    ).toEqual({
      kind: 'none',
      reason: 'no_mandate',
      warnings: [{ code: 'document_missing', kind: 'urssaf_vigilance' }],
    });
  });

  it('issues nothing under a tax treaty without a residence certificate of the period’s year the owner accepted', () => {
    // Charles's choice (a): never the 25 % withholding; the certificate is no warning, it holds the invoice back.
    expect(issueDecision(facts({ documents: [] }))).toEqual({
      kind: 'none',
      reason: 'tax_residence_missing',
      warnings: [],
    });
    const pending = { ...RESIDENCE_2026, review: null };
    expect(issueDecision(facts({ documents: [pending] }))).toMatchObject({
      reason: 'tax_residence_unverified',
    });
    const refused = {
      ...RESIDENCE_2026,
      review: { decision: 'refused', reason: 'Année illisible.' },
    } as const;
    expect(issueDecision(facts({ documents: [refused] }))).toMatchObject({ reason: 'tax_residence_missing' });
    // The certificate of 2025 does not cover a fortnight of 2026, even issued in December.
    const lastYear = { ...RESIDENCE_2026, issuedOn: '2025-12-20' };
    expect(issueDecision(facts({ documents: [lastYear] }))).toMatchObject({
      reason: 'tax_residence_missing',
    });
    // A December fortnight invoiced in January keeps the certificate of its own year.
    expect(
      issueDecision(facts({ day: '2027-01-05', period: PayPeriodSchema.parse('2026-12-16') })),
    ).toMatchObject({ kind: 'issue' });
    expect(
      issueDecision(facts({ day: '2027-01-20', period: PayPeriodSchema.parse('2027-01-01') })),
    ).toMatchObject({ reason: 'tax_residence_missing' });
    // An identity to complete or to check comes first: the certificate is checked with the file.
    expect(issueDecision(facts({ documents: [], identityVerified: false }))).toMatchObject({
      reason: 'identity_unverified',
    });
    // Without a treaty (France), the regime asks for no residence certificate.
    expect(
      issueDecision(facts({ regimes: [{ ...ABROAD, withholding: 'none' }, FRANCHISE], documents: [] })),
    ).toEqual({
      kind: 'issue',
      regime: { ...ABROAD, withholding: 'none' },
      warnings: [{ code: 'document_missing', kind: 'tax_residence' }],
    });
  });

  it('tells a certificate covering the year, one waiting for the check, and none', () => {
    const period = PayPeriodSchema.parse('2026-05-01');
    expect(taxResidenceFor([RESIDENCE_2026], period)).toBe('covered');
    expect(taxResidenceFor([{ ...RESIDENCE_2026, review: null }], period)).toBe('unverified');
    expect(taxResidenceFor([{ ...RESIDENCE_2026, review: null }, RESIDENCE_2026], period)).toBe('covered');
    // The year it states, when it states one: a certificate issued in December for the next year.
    const next = { ...RESIDENCE_2026, issuedOn: '2026-12-15', validUntil: '2027-12-31' };
    expect(taxResidenceFor([next], period)).toBe('missing');
    expect(taxResidenceFor([next], PayPeriodSchema.parse('2027-01-01'))).toBe('covered');
    expect(taxResidenceFor([], period)).toBe('missing');
  });
});
