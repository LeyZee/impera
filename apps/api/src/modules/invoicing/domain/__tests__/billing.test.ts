import { describe, expect, it } from 'vitest';

import {
  assertRegimeChange,
  documentReminderFrom,
  documentsFollowed,
  documentsToRemind,
  documentState,
  documentValidUntil,
  regimeOn,
  taxResidenceOf,
  type BillingRegime,
} from '../../../contractors/domain/billing';
import { issueDecision, type IssueFacts } from '../billing';

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

/** A tax residence certificate of 2026, accepted by the owner. */
const RESIDENCE_2026 = {
  kind: 'tax_residence',
  issuedOn: '2026-03-10',
  validUntil: null,
  review: { decision: 'accepted' },
} as const;

const facts = (patch: Partial<IssueFacts> = {}): IssueFacts => ({
  day: '2026-11-02',
  mandate: { acceptedVersion: 1, currentVersion: 1 },
  assignments: [{ regimeId: 'abroad', from: '2026-10-01' }],
  regimes: [ABROAD, FRANCHISE],
  // Every regime of the test counts as one of his country, unless a test says otherwise.
  regimesOfCountry: new Set(['abroad', 'franchise']),
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

  it('call a residence certificate for renewal from the 1st of December of its year, whatever the delay', () => {
    // « ok année civile »: renewed in January, said a month ahead.
    const residence = { kind: 'tax_residence', issuedOn: '2026-03-10', validUntil: null } as const;
    for (const delay of [1, 30, 90]) expect(documentReminderFrom(residence, delay)).toBe('2026-12-01');
    expect(documentState(residence, '2026-11-30', 90)).toBe('valid');
    expect(documentState(residence, '2026-12-01', 1)).toBe('expiring');
    expect(documentState(residence, '2026-12-31', 1)).toBe('expiring');
    expect(documentState(residence, '2027-01-01', 1)).toBe('expired');
    const vigilance = { kind: 'urssaf_vigilance', issuedOn: '2026-05-15', validUntil: null } as const;
    expect(documentReminderFrom(vigilance, 15)).toBe('2026-10-30');
  });

  it('remind the newest of each kind the regime asks for, once due, never a refused one nor a kind not asked', () => {
    const of = (id: string, kind: 'tax_residence' | 'urssaf_vigilance', issuedOn: string) => ({
      id,
      kind,
      issuedOn,
      validUntil: null,
      review: null,
    });
    const residence = of('residence-2026', 'tax_residence', '2026-03-10');
    const vigilance = of('vigilance', 'urssaf_vigilance', '2026-06-20');
    expect(documentsToRemind(ABROAD, [residence, vigilance], '2026-11-30', 30)).toEqual([]);
    // Only the kinds of the regime: the vigilance certificate, due too, is not this regime's.
    expect(documentsToRemind(ABROAD, [residence, vigilance], '2026-12-01', 30)).toEqual([residence]);
    // Past its end and still the newest: reminded (once, by the job).
    expect(documentsToRemind(ABROAD, [residence], '2027-02-01', 30)).toEqual([residence]);
    // A newer one filed, even waiting for the owner's check, ends the reminder of the older.
    const next = of('residence-2027', 'tax_residence', '2027-01-05');
    expect(documentsToRemind(ABROAD, [residence, next], '2027-01-06', 30)).toEqual([]);
    // A refused newer one counts as none.
    const refused = { ...next, review: { decision: 'refused', reason: 'Illisible.' } } as const;
    expect(documentsToRemind(ABROAD, [residence, refused], '2027-01-06', 30)).toEqual([residence]);
    // Nothing filed, or no regime: nothing to remind here.
    expect(documentsToRemind(ABROAD, [], '2026-12-01', 30)).toEqual([]);
    expect(documentsToRemind(null, [residence], '2026-12-01', 30)).toEqual([]);
    expect(documentsToRemind(FRANCHISE, [vigilance], '2026-11-19', 30)).toEqual([vigilance]);
  });

  it('follows, whatever the day, the newest of each kind the regime asks for that the owner has not refused (lot 8)', () => {
    const of = (id: string, kind: 'tax_residence' | 'urssaf_vigilance', issuedOn: string) => ({
      id,
      kind,
      issuedOn,
      validUntil: null,
      review: null,
    });
    const residence = of('residence-2026', 'tax_residence', '2026-03-10');
    const next = of('residence-2027', 'tax_residence', '2027-01-05');
    const vigilance = of('vigilance', 'urssaf_vigilance', '2026-06-20');
    expect(documentsFollowed(ABROAD, [residence, vigilance])).toEqual([residence]);
    expect(documentsFollowed(ABROAD, [residence, next])).toEqual([next]);
    const refused = { ...next, review: { decision: 'refused', reason: 'Illisible.' } } as const;
    expect(documentsFollowed(ABROAD, [residence, refused])).toEqual([residence]);
    expect(documentsFollowed(null, [residence])).toEqual([]);
    expect(documentsFollowed(FRANCHISE, [residence, vigilance])).toEqual([vigilance]);
  });
});

describe('whether a validated statement issues its invoice (EQ-06)', () => {
  it('issues under the regime of the day, with no warning when the file is complete', () => {
    expect(issueDecision(facts())).toEqual({ kind: 'issue', regime: ABROAD, warnings: [] });
  });

  it('issues nothing without a mandate, a regime validated and of his country, or the identity the mentions need', () => {
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
    // His record now gives a country the regime was not written for (« ok pays »): its mentions would be another
    // country's. Said before his file, which a regime of his country may ask otherwise.
    expect(issueDecision(facts({ regimesOfCountry: new Set(['franchise']) }))).toMatchObject({
      kind: 'none',
      reason: 'regime_country_mismatch',
    });
    expect(issueDecision(facts({ regimesOfCountry: new Set(['franchise']), identity: null }))).toMatchObject({
      reason: 'regime_country_mismatch',
    });
    expect(
      issueDecision(
        facts({ regimesOfCountry: new Set(['franchise']), regimes: [{ ...ABROAD, validatedOn: null }] }),
      ),
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
        regimesOfCountry: new Set(['charged']),
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

  it('issues under a tax treaty without the residence certificate: it gates the transfer, not the invoice (ADR 0041)', () => {
    // Neither a reason to hold the invoice nor a warning: the transfer waits for it (`payoutDecision`).
    for (const documents of [[], [{ ...RESIDENCE_2026, review: null }]]) {
      expect(issueDecision(facts({ documents }))).toEqual({ kind: 'issue', regime: ABROAD, warnings: [] });
    }
    // An identity to complete or to check still comes first.
    expect(issueDecision(facts({ documents: [], identityVerified: false }))).toMatchObject({
      reason: 'identity_unverified',
    });
    // Without a treaty (France), a residence certificate the regime asks for is a warning, as any document.
    expect(
      issueDecision(facts({ regimes: [{ ...ABROAD, withholding: 'none' }, FRANCHISE], documents: [] })),
    ).toEqual({
      kind: 'issue',
      regime: { ...ABROAD, withholding: 'none' },
      warnings: [{ code: 'document_missing', kind: 'tax_residence' }],
    });
  });

  it('tells a certificate covering the year, one waiting for the check, and none', () => {
    expect(taxResidenceOf([RESIDENCE_2026], '2026')).toEqual({ state: 'covered', document: RESIDENCE_2026 });
    expect(taxResidenceOf([{ ...RESIDENCE_2026, review: null }], '2026')).toEqual({ state: 'unverified' });
    const pending = { ...RESIDENCE_2026, review: null };
    expect(taxResidenceOf([pending, RESIDENCE_2026], '2026')).toMatchObject({ state: 'covered' });
    // The newest accepted of the year, when there are two.
    const renewed = { ...RESIDENCE_2026, issuedOn: '2026-06-02' };
    expect(taxResidenceOf([RESIDENCE_2026, renewed], '2026')).toEqual({
      state: 'covered',
      document: renewed,
    });
    // A refused one counts as none.
    const refused = {
      ...RESIDENCE_2026,
      review: { decision: 'refused', reason: 'Année illisible.' },
    } as const;
    expect(taxResidenceOf([refused], '2026')).toEqual({ state: 'missing' });
    // The year it states, when it states one: a certificate issued in December for the next year.
    const next = { ...RESIDENCE_2026, issuedOn: '2026-12-15', validUntil: '2027-12-31' };
    expect(taxResidenceOf([next], '2026')).toEqual({ state: 'missing' });
    expect(taxResidenceOf([next], '2027')).toEqual({ state: 'covered', document: next });
    expect(taxResidenceOf([], '2026')).toEqual({ state: 'missing' });
  });
});
