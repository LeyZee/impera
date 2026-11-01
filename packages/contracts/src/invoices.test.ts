import { describe, expect, it } from 'vitest';

import {
  AGENCY_LOGO_REFUSALS,
  AgencyLogoMediaTypeSchema,
  AgencyLogoSchema,
  BillingAgencyBodySchema,
  BillingRegimeSchema,
  BillingSettingsSchema,
  BillingSettingsViewSchema,
  BusinessIdSchema,
  ContestInvoiceBodySchema,
  ContractorProfileBodySchema,
  ContractorProfileSchema,
  CreateContractTextBodySchema,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  DEFAULT_INVOICE_DUE_DAYS,
  INVOICE_ERROR_CODES,
  INVOICE_REASON_MAX,
  InvoiceAcceptanceViewSchema,
  InvoiceAgencySchema,
  InvoiceContractorSchema,
  InvoiceNumberSchema,
  InvoiceParamsSchema,
  InvoicePrefixSchema,
  InvoiceSchema,
  RefuseInvoiceContestBodySchema,
  RegimeVatSchema,
  SERVICE_DESCRIPTION_MAX,
  ServiceDescriptionSchema,
  UpdateBillingSettingsBodySchema,
  VatNumberSchema,
  addressLines,
  frenchVatNumberOf,
  invoiceFooterOf,
  legalFormWords,
  shareCapitalWords,
  sirenChecksOut,
  sirenWords,
} from './invoices';

// Invented parties (ADR 0010): no real name, address nor identifier.
const invoice = {
  id: '0190a0b0-0000-7000-8000-000000000001',
  kind: 'invoice',
  memberId: '0190a0b0-0000-7000-8000-000000000002',
  statementId: '0190a0b0-0000-7000-8000-000000000003',
  creditedInvoiceId: null,
  period: '2026-11-01',
  number: 'KOFI-2026-0001',
  issuedAt: '2026-11-17T09:00:00.000Z',
  issuedOn: '2026-11-17',
  dueOn: '2026-12-02',
  contractor: { legalName: 'Kofi Exemple', address: '12 rue Inventée, Cotonou', country: 'BJ', taxId: null },
  agency: {
    legalName: 'Agence Exemple SAS',
    address: '1 place Fictive, 69000 Lyon',
    siren: '123456789',
    vatNumber: 'FR12123456789',
  },
  regime: {
    id: '0190a0b0-0000-7000-8000-000000000004',
    name: 'Bénin et Madagascar',
    vat: { treatment: 'reverse_charge', rateBps: 2000 },
    withholding: 'treaty_exempt',
    mentions: ['Autoliquidation'],
    documents: ['tax_residence'],
    taxIdRequired: false,
    validatedOn: '2026-10-30',
  },
  mentions: ['Autofacturation', 'Autoliquidation'],
  serviceDescription: 'Animation commerciale de comptes, rémunérée à la commission',
  logoSha256: null,
  lines: [{ kind: 'commission', label: 'Commission', detail: null, amountMinor: 12_000 }],
  totals: { exclVatMinor: 12_000, vatMinor: 0, inclVatMinor: 12_000, selfAssessedVatMinor: 2_400 },
  acceptance: { state: 'pending', deadline: '2026-11-24T09:00:00.000Z', reason: null },
  pdfSha256: null,
} as const;

describe('invoices', () => {
  it('give every error code a suffix that sets its status (api.md)', () => {
    for (const code of INVOICE_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|unprocessable|forbidden|unavailable)$/u);
    }
  });

  it('take a prefix of two to eight capitals or digits, and a number that grows past four digits', () => {
    expect(InvoicePrefixSchema.safeParse('KOFI').success).toBe(true);
    expect(InvoicePrefixSchema.safeParse('K').success).toBe(false);
    expect(InvoicePrefixSchema.safeParse('kofi').success).toBe(false);
    expect(InvoicePrefixSchema.safeParse('ABCDEFGHI').success).toBe(false);
    expect(InvoiceNumberSchema.safeParse('KOFI-2026-0001').success).toBe(true);
    expect(InvoiceNumberSchema.safeParse('KOFI-2026-12345').success).toBe(true);
    expect(InvoiceNumberSchema.safeParse('KOFI-2026-001').success).toBe(false);
  });

  it('give a rate to VAT that is charged or self-assessed, none to the franchise', () => {
    expect(RegimeVatSchema.safeParse({ treatment: 'exempt' }).success).toBe(true);
    expect(RegimeVatSchema.safeParse({ treatment: 'charged', rateBps: 2000 }).success).toBe(true);
    expect(RegimeVatSchema.safeParse({ treatment: 'charged' }).success).toBe(false);
    expect(RegimeVatSchema.safeParse({ treatment: 'reverse_charge', rateBps: 10_001 }).success).toBe(false);
  });

  it('keep a regime for one country or more', () => {
    const regime = { ...invoice.regime, countries: ['BJ', 'MG'], createdAt: '2026-10-30T08:00:00.000Z' };
    expect(BillingRegimeSchema.safeParse(regime).success).toBe(true);
    expect(BillingRegimeSchema.safeParse({ ...regime, countries: [] }).success).toBe(false);
  });

  it('read an invoice with its statement and a positive total, a credit note citing its invoice in negative', () => {
    expect(InvoiceSchema.safeParse(invoice).success).toBe(true);
    expect(InvoiceSchema.safeParse({ ...invoice, statementId: null }).success).toBe(false);
    expect(
      InvoiceSchema.safeParse({
        ...invoice,
        totals: { exclVatMinor: 0, vatMinor: 0, inclVatMinor: 0, selfAssessedVatMinor: 0 },
      }).success,
    ).toBe(false);
    const note = {
      ...invoice,
      kind: 'credit_note',
      number: 'KOFI-2026-0002',
      creditedInvoiceId: invoice.id,
      lines: [{ kind: 'reduction', label: 'Réduction', detail: '« Erreur de saisie »', amountMinor: -2_000 }],
      totals: { exclVatMinor: -2_000, vatMinor: 0, inclVatMinor: -2_000, selfAssessedVatMinor: -400 },
    };
    expect(InvoiceSchema.safeParse(note).success).toBe(true);
    expect(InvoiceSchema.safeParse({ ...note, creditedInvoiceId: null }).success).toBe(false);
  });

  it('fall due 45 to 60 days after their issue, 60 by default (art. L441-10, ADR 0038)', () => {
    const settings = (dueDays: number) => ({
      agency: invoice.agency,
      paymentTerms:
        'Aucun escompte. Pénalités de retard au triple du taux d’intérêt légal, indemnité de 40 €.',
      dueDays,
      documentReminderDays: 30,
      fiscalYearEndMonth: 12,
      serviceDescription: null,
      logoSha256: null,
      accounts: { expense: '622', supplierPrefix: '401', vatDeductible: '44566', vatSelfAssessed: '4452' },
      updatedAt: '2026-10-31T09:00:00.000Z',
    });
    expect(DEFAULT_INVOICE_DUE_DAYS).toBe(60);
    for (const ok of [45, 60]) expect(BillingSettingsSchema.safeParse(settings(ok)).success).toBe(true);
    for (const wrong of [15, 44, 61, 90])
      expect(BillingSettingsSchema.safeParse(settings(wrong)).success).toBe(false);
  });

  it('closes the fiscal year at the end of one month of the year, the calendar year by default', () => {
    const settings = (fiscalYearEndMonth: number) => ({
      agency: invoice.agency,
      paymentTerms: 'Aucun escompte.',
      dueDays: 60,
      documentReminderDays: 30,
      fiscalYearEndMonth,
      serviceDescription: 'Animation commerciale de comptes',
      logoSha256: 'a'.repeat(64),
      accounts: { expense: '622', supplierPrefix: '401', vatDeductible: '44566', vatSelfAssessed: '4452' },
      updatedAt: '2026-10-31T09:00:00.000Z',
    });
    expect(DEFAULT_FISCAL_YEAR_END_MONTH).toBe(12);
    for (const ok of [1, 6, 12]) expect(BillingSettingsSchema.safeParse(settings(ok)).success).toBe(true);
    for (const wrong of [0, 13, 6.5])
      expect(BillingSettingsSchema.safeParse(settings(wrong)).success).toBe(false);
  });
  it('keep the journal’s accounts empty until the accountant gives them, whole or not at all (migration 0048)', () => {
    const settings = (accounts: unknown) => ({
      agency: invoice.agency,
      paymentTerms: 'Aucun escompte.',
      dueDays: 60,
      documentReminderDays: 30,
      fiscalYearEndMonth: 12,
      serviceDescription: 'Animation commerciale de comptes',
      logoSha256: null,
      accounts,
      updatedAt: '2026-11-01T09:00:00.000Z',
    });
    expect(BillingSettingsSchema.safeParse(settings(null)).success).toBe(true);
    expect(BillingSettingsSchema.safeParse(settings({})).success).toBe(false);
    expect(BillingSettingsSchema.safeParse(settings({ expense: '622' })).success).toBe(false);
    expect(BillingSettingsViewSchema.safeParse({ settings: null, logo: null }).success).toBe(true);
  });

  it('are saved with the foot of the page whole: legal form, share capital, town of the trade register', () => {
    const body = {
      agency: {
        ...invoice.agency,
        // Invented, with a right check key and the VAT number it gives.
        siren: '123456782',
        vatNumber: 'FR11123456782',
        legalForm: 'SAS',
        shareCapitalMinor: 1_000_000,
        rcsCity: 'Lyon',
      },
      serviceDescription: 'Animation commerciale de comptes',
      paymentTerms: 'Aucun escompte.',
      dueDays: 60,
      fiscalYearEndMonth: 12,
      logoSha256: null,
    };
    expect(UpdateBillingSettingsBodySchema.parse(body)).toEqual(body);
    for (const agency of [
      { ...body.agency, legalForm: null },
      { ...body.agency, shareCapitalMinor: 0 },
      { ...body.agency, rcsCity: ' ' },
      {
        legalName: body.agency.legalName,
        address: body.agency.address,
        siren: body.agency.siren,
        vatNumber: body.agency.vatNumber,
      },
    ]) {
      expect(UpdateBillingSettingsBodySchema.safeParse({ ...body, agency }).success).toBe(false);
    }
    expect(UpdateBillingSettingsBodySchema.safeParse({ ...body, serviceDescription: null }).success).toBe(
      false,
    );
    expect(UpdateBillingSettingsBodySchema.safeParse({ ...body, dueDays: 61 }).success).toBe(false);
  });

  it('save a SIREN only with its check key, and the VAT number that SIREN gives', () => {
    // Invented numbers; La Poste's SIREN is public, and passes like any other.
    for (const siren of ['123456782', '987654324', '356000000']) expect(sirenChecksOut(siren)).toBe(true);
    for (const siren of ['123456789', '987654321', '12345678', '12345678a']) {
      expect(sirenChecksOut(siren)).toBe(false);
    }
    expect(frenchVatNumberOf('123456782')).toBe('FR11123456782');
    expect(frenchVatNumberOf('987654324')).toBe('FR14987654324');
    // A key below ten keeps its two digits.
    expect(frenchVatNumberOf('987654321')).toBe('FR05987654321');

    const agency = {
      legalName: 'Agence Exemple SAS',
      address: '1 place Fictive, 69000 Lyon',
      siren: '123456782',
      vatNumber: 'FR11123456782',
      legalForm: 'SAS',
      shareCapitalMinor: 1_000_000,
      rcsCity: 'Lyon',
    };
    expect(BillingAgencyBodySchema.safeParse(agency).success).toBe(true);
    const wrongKey = BillingAgencyBodySchema.safeParse({ ...agency, siren: '123456789' });
    expect(wrongKey.error?.issues.map((issue) => issue.path)).toEqual([['siren']]);
    const otherVat = BillingAgencyBodySchema.safeParse({ ...agency, vatNumber: 'FR12123456782' });
    expect(otherVat.error?.issues).toEqual([
      expect.objectContaining({
        path: ['vatNumber'],
        message: 'Le numéro de TVA intracommunautaire de ce SIREN est FR11123456782.',
      }),
    ]);
    expect(BillingAgencyBodySchema.safeParse({ ...agency, vatNumber: 'BE0123456789' }).success).toBe(false);
    // A copy made before is read as it is: the check is the setting's, at its save.
    expect(
      InvoiceAgencySchema.safeParse({ ...agency, siren: '123456789', vatNumber: 'FR12123456789' }).success,
    ).toBe(true);
  });

  it('print one foot of the page, the PDF’s and Réglages › Facturation’s: form, capital, register (art. R123-237)', () => {
    const agency = {
      legalName: 'Agence Exemple SAS',
      address: '1 place Fictive\r\n\n69000 Lyon ',
      siren: '123456782',
      vatNumber: 'FR11123456782',
      legalForm: 'SAS',
      shareCapitalMinor: 1_000_000,
      rcsCity: 'Lyon',
    };
    expect(addressLines(agency.address)).toEqual(['1 place Fictive', '69000 Lyon']);
    expect(shareCapitalWords(1_000_000)).toBe('10\u202f000\u00a0€');
    expect(shareCapitalWords(100_050)).toBe('1\u202f000,50\u00a0€');
    expect(sirenWords('123456782')).toBe('123\u00a0456\u00a0782');
    expect(legalFormWords(agency)).toBe('SAS au capital de 10\u202f000\u00a0€');
    expect(legalFormWords({ ...agency, shareCapitalMinor: null })).toBe('SAS');
    expect(legalFormWords({ ...agency, legalForm: null })).toBeNull();
    expect(invoiceFooterOf(agency)).toBe(
      'Document établi par Agence Exemple SAS, 1 place Fictive, 69000 Lyon · SAS au capital de 10\u202f000\u00a0€ · ' +
        'RCS\u00a0Lyon\u00a0123\u00a0456\u00a0782, mandataire de facturation du prestataire.',
    );
    // A copy made before lot 4: the agency and its address alone.
    expect(
      invoiceFooterOf({
        legalName: agency.legalName,
        address: agency.address,
        siren: agency.siren,
        vatNumber: agency.vatNumber,
      }),
    ).toBe(
      'Document établi par Agence Exemple SAS, 1 place Fictive, 69000 Lyon, mandataire de facturation du prestataire.',
    );
  });

  it('describe a kept logo by its fingerprint, its sides and its weight, and name each reason to refuse one', () => {
    const logo = {
      sha256: 'a'.repeat(64),
      mediaType: 'image/png',
      width: 1_843,
      height: 522,
      byteLength: 443_725,
    };
    expect(AgencyLogoSchema.parse(logo)).toEqual(logo);
    expect(AgencyLogoSchema.safeParse({ ...logo, width: 63 }).success).toBe(false);
    expect(AgencyLogoSchema.safeParse({ ...logo, byteLength: 512 * 1024 + 1 }).success).toBe(false);
    expect(AgencyLogoSchema.safeParse({ ...logo, mediaType: 'image/svg+xml' }).success).toBe(false);
    expect(AGENCY_LOGO_REFUSALS).toEqual(['too_heavy', 'not_png', 'damaged', 'opaque', 'dimensions']);
  });

  it('print a French contractor with his SIREN or SIRET, his VAT number and « EI », and read a copy made before', () => {
    expect(BusinessIdSchema.safeParse('123456789').success).toBe(true);
    expect(BusinessIdSchema.safeParse('12345678900011').success).toBe(true);
    for (const wrong of ['12345678', '1234567890', '123 456 789', 'FR123456789']) {
      expect(BusinessIdSchema.safeParse(wrong).success).toBe(false);
    }
    expect(VatNumberSchema.safeParse('FR12123456789').success).toBe(true);
    expect(VatNumberSchema.safeParse('fr12123456789').success).toBe(false);
    const french = {
      legalName: 'Basile Exemple',
      address: '3 place Inventée, Lyon',
      country: 'FR',
      taxId: null,
      businessId: '12345678900011',
      vatNumber: 'FR12123456789',
      individualEntrepreneur: true,
    };
    expect(InvoiceContractorSchema.safeParse(french).success).toBe(true);
    // A frozen copy of lot 3 has none of the three: it still reads, and prints as it was written.
    expect(InvoiceContractorSchema.safeParse(invoice.contractor).success).toBe(true);
    expect(InvoiceContractorSchema.safeParse({ ...french, businessId: '123' }).success).toBe(false);
    // A company's copy carries its form, a capital of at least 1 cent and its register town, as its file does.
    const company = {
      ...french,
      legalName: 'Chloé Exemple SARL',
      businessId: '987654321',
      individualEntrepreneur: false,
      legalForm: 'SARL',
      shareCapitalMinor: 750_000,
      rcsCity: 'Marseille',
    };
    expect(InvoiceContractorSchema.safeParse(company).success).toBe(true);
    expect(InvoiceContractorSchema.safeParse({ ...company, shareCapitalMinor: 0 }).success).toBe(false);
    expect(ContractorProfileSchema.shape.shareCapitalMinor.safeParse(0).success).toBe(false);
  });

  it('keep the agency’s legal form, capital and register town optional, and its logo a PNG', () => {
    const full = { ...invoice.agency, legalForm: 'SAS', shareCapitalMinor: 100_000, rcsCity: 'Lyon' };
    expect(InvoiceAgencySchema.safeParse(full).success).toBe(true);
    expect(InvoiceAgencySchema.safeParse(invoice.agency).success).toBe(true);
    expect(InvoiceAgencySchema.safeParse({ ...full, shareCapitalMinor: -1 }).success).toBe(false);
    expect(AgencyLogoMediaTypeSchema.safeParse('image/png').success).toBe(true);
    for (const wrong of ['image/jpeg', 'image/svg+xml', 'image/gif']) {
      expect(AgencyLogoMediaTypeSchema.safeParse(wrong).success).toBe(false);
    }
    expect(ServiceDescriptionSchema.safeParse('x'.repeat(SERVICE_DESCRIPTION_MAX)).success).toBe(true);
    expect(ServiceDescriptionSchema.safeParse('x'.repeat(SERVICE_DESCRIPTION_MAX + 1)).success).toBe(false);
    expect(ServiceDescriptionSchema.safeParse('  ').success).toBe(false);
  });

  it('name a document by its id, never by its number', () => {
    expect(InvoiceParamsSchema.safeParse({ invoiceId: invoice.id }).success).toBe(true);
    expect(InvoiceParamsSchema.safeParse({ invoiceId: 'KOFI-2026-0001' }).success).toBe(false);
  });

  it('take a contest and its refusal with a reason of 1 to 500 characters, trimmed (ADR 0039 § 1)', () => {
    for (const schema of [ContestInvoiceBodySchema, RefuseInvoiceContestBodySchema]) {
      expect(schema.parse({ reason: '  Une vente du 3 manque ' })).toEqual({
        reason: 'Une vente du 3 manque',
      });
      expect(schema.safeParse({ reason: 'x'.repeat(INVOICE_REASON_MAX) }).success).toBe(true);
      for (const reason of ['', '   ', 'x'.repeat(INVOICE_REASON_MAX + 1)]) {
        expect(schema.safeParse({ reason }).success, reason).toBe(false);
      }
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it('read a document’s acceptance with its steps, the issue first', () => {
    const view = {
      invoiceId: invoice.id,
      kind: 'invoice',
      memberId: invoice.memberId,
      number: invoice.number,
      acceptance: {
        state: 'contested',
        deadline: '2026-11-24T09:00:00.000Z',
        reason: 'Une vente du 3 manque',
      },
      events: [
        {
          id: '0190a0b0-0000-7000-8000-000000000010',
          invoiceId: invoice.id,
          kind: 'issued',
          reason: null,
          statementId: null,
          by: null,
          at: '2026-11-17T09:00:00.000Z',
        },
        {
          id: '0190a0b0-0000-7000-8000-000000000011',
          invoiceId: invoice.id,
          kind: 'contested',
          reason: 'Une vente du 3 manque',
          statementId: null,
          by: '0190a0b0-0000-7000-8000-000000000012',
          at: '2026-11-18T10:00:00.000Z',
        },
      ],
    };
    expect(InvoiceAcceptanceViewSchema.parse(view)).toEqual(view);
    expect(InvoiceAcceptanceViewSchema.safeParse({ ...view, events: [] }).success).toBe(false);
    expect(
      InvoiceAcceptanceViewSchema.safeParse({ ...view, acceptance: { ...view.acceptance, state: 'lost' } })
        .success,
    ).toBe(false);
  });

  describe('Équipe › Dossier prestataire, contrat et mandat (lot 5a)', () => {
    /** An invented French company: its SIREN has a right check key, its VAT number is the one it gives. */
    const company = {
      legalName: 'Théo Inventé SARL',
      address: '3 rue Imaginaire\n69001 Lyon',
      taxId: null,
      businessId: '12345678200011',
      vatNumber: 'FR11123456782',
      individualEntrepreneur: false,
      legalForm: 'SARL',
      shareCapitalMinor: 100_000,
      rcsCity: 'Lyon',
      email: 'theo@example.test',
    };

    it('takes a file whose SIREN, VAT number and company mentions hold together', () => {
      expect(ContractorProfileBodySchema.parse(company)).toEqual(company);
      // Abroad: no SIREN, a VAT number of another country is not checked against one.
      const abroad = {
        ...company,
        businessId: null,
        vatNumber: null,
        legalForm: null,
        shareCapitalMinor: null,
        rcsCity: null,
      };
      expect(ContractorProfileBodySchema.safeParse(abroad).success).toBe(true);
      expect(ContractorProfileBodySchema.safeParse({ ...company, vatNumber: 'BE0123456789' }).success).toBe(
        true,
      );
    });

    it('refuses a SIREN with a wrong key, a French VAT number of another SIREN, a company half told', () => {
      const refused = (body: object): string[] => {
        const result = ContractorProfileBodySchema.safeParse(body);
        return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
      };
      expect(refused({ ...company, businessId: '12345678900011' })).toEqual(['businessId']);
      expect(refused({ ...company, vatNumber: 'FR12123456782' })).toEqual(['vatNumber']);
      expect(refused({ ...company, shareCapitalMinor: null })).toEqual(['legalForm']);
      expect(refused({ ...company, individualEntrepreneur: true })).toEqual(['legalForm']);
      expect(refused({ ...company, shareCapitalMinor: 0 })).toEqual(['shareCapitalMinor']);
    });

    it('keeps a contract text exactly as pasted, a mandate with its delay to contest', () => {
      const id = '0190a0b0-0000-7000-8000-000000000020';
      const body = '  Contrat de prestation (texte inventé).\n';
      expect(CreateContractTextBodySchema.parse({ id, kind: 'service_contract', body })).toEqual({
        id,
        kind: 'service_contract',
        body,
      });
      expect(
        CreateContractTextBodySchema.safeParse({ id, kind: 'service_contract', body: ' \n ' }).success,
      ).toBe(false);
      expect(CreateContractTextBodySchema.safeParse({ id, kind: 'billing_mandate', body }).success).toBe(
        false,
      );
      for (const contestDelayDays of [0, 61, 7.5]) {
        expect(
          CreateContractTextBodySchema.safeParse({ id, kind: 'billing_mandate', body, contestDelayDays })
            .success,
        ).toBe(false);
      }
      expect(
        CreateContractTextBodySchema.safeParse({ id, kind: 'billing_mandate', body, contestDelayDays: 7 })
          .success,
      ).toBe(true);
    });
  });
});
