import { describe, expect, it } from 'vitest';

import {
  ACCOUNTING_PERIOD_MAX_DAYS,
  ACCOUNTING_JOURNAL_MEDIA_TYPE,
  AccountingPeriodQuerySchema,
  AccountingJournalSchema,
  AGENCY_LOGO_REFUSALS,
  AgencyLogoMediaTypeSchema,
  AgencyLogoSchema,
  AssignContractorRegimeBodySchema,
  BillingAgencyBodySchema,
  BillingRegimeSchema,
  BillingSettingsSchema,
  BillingSettingsViewSchema,
  BusinessIdSchema,
  CONTRACTOR_DOCUMENT_MEDIA_TYPES,
  CONTRACTOR_DOCUMENTS_PENDING_MAX,
  ContestInvoiceBodySchema,
  ContractorDocumentReviewSchema,
  ContractorDocumentsQuerySchema,
  ContractorProfileBodySchema,
  ContractorProfileSchema,
  CreateBillingRegimeBodySchema,
  CreateContractTextBodySchema,
  DAS2_FIRST_YEAR,
  DAS2_MEDIA_TYPE,
  Das2BeneficiarySchema,
  Das2ExportSchema,
  Das2QuerySchema,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  DEFAULT_INVOICE_DUE_DAYS,
  INVOICE_ERROR_CODES,
  INVOICE_REASON_MAX,
  InvoiceAcceptanceViewSchema,
  InvoiceAgencySchema,
  InvoiceContractorSchema,
  InvoiceListQuerySchema,
  InvoiceNumberSchema,
  InvoiceParamsSchema,
  InvoicePrefixSchema,
  InvoiceSchema,
  JOURNAL_ACCOUNT_NAMES,
  JournalAccountsSchema,
  PendingContractorDocumentsSchema,
  RefuseInvoiceContestBodySchema,
  RegimeVatSchema,
  SERVICE_DESCRIPTION_MAX,
  ServiceDescriptionSchema,
  UpdateBillingSettingsBodySchema,
  UploadContractorDocumentQuerySchema,
  ValidateBillingRegimeBodySchema,
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
      expect(code).toMatch(/_(not_found|invalid|conflict|gone|unprocessable|forbidden|unavailable)$/u);
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
      accounts: null,
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
      accounts: null,
      updatedAt: '2026-10-31T09:00:00.000Z',
    });
    expect(DEFAULT_FISCAL_YEAR_END_MONTH).toBe(12);
    for (const ok of [1, 6, 12]) expect(BillingSettingsSchema.safeParse(settings(ok)).success).toBe(true);
    for (const wrong of [0, 13, 6.5])
      expect(BillingSettingsSchema.safeParse(settings(wrong)).success).toBe(false);
  });
  it('keep the journal’s accounts empty until the accountant gives them, each one named, null until given', () => {
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

  it('keep the VAT owed off the deductible accounts and the two journals apart (EQ-06 lot 7b)', () => {
    const accounts = {
      expense: '622600',
      supplier: '401',
      vatDeductible: '445660',
      vatSelfAssessedDeductible: '445662',
      vatSelfAssessedDue: '445200',
      bank: '512000',
      purchaseJournal: 'HA',
      bankJournal: 'BQ',
    };
    expect(JournalAccountsSchema.parse(accounts)).toEqual(accounts);
    const none = Object.fromEntries(JOURNAL_ACCOUNT_NAMES.map((name) => [name, null]));
    expect(JournalAccountsSchema.safeParse(none).success).toBe(true);
    expect(JournalAccountsSchema.safeParse({ ...none, expense: '622600' }).success).toBe(true);
    const refused = (change: Record<string, string>) =>
      JournalAccountsSchema.safeParse({ ...accounts, ...change });
    expect(refused({ vatSelfAssessedDue: '445660' }).error?.issues[0]?.path).toEqual(['vatSelfAssessedDue']);
    expect(refused({ vatSelfAssessedDue: '445662' }).success).toBe(false);
    expect(refused({ bankJournal: 'HA' }).error?.issues[0]?.path).toEqual(['bankJournal']);
    for (const code of ['512 000', '512-000', 'ba', '', 'A'.repeat(21)])
      expect(refused({ bank: code }).success, code).toBe(false);
    for (const code of ['ha', 'ACHATS123', ''])
      expect(refused({ purchaseJournal: code }).success, code).toBe(false);
    // The VAT owed is checked only once given: a deductible account alone is never refused.
    expect(
      JournalAccountsSchema.safeParse({ ...none, vatDeductible: '4456', vatSelfAssessedDeductible: '4456' })
        .success,
    ).toBe(true);
  });

  it('lists documents within a bound, with lists of known values once each (lot 8)', () => {
    const parsed = (query: Record<string, string>) => InvoiceListQuerySchema.safeParse(query);
    expect(parsed({ due: 'soon,overdue' }).data).toEqual({ due: ['soon', 'overdue'] });
    expect(parsed({ acceptance: 'contested' }).success).toBe(true);
    expect(parsed({ acceptance: 'pending,contested' }).success).toBe(true);
    expect(parsed({ period: '2026-10-16' }).success).toBe(true);
    expect(parsed({ from: '2024-01-01', to: '2024-12-31', due: 'settled' }).success).toBe(true);
    // 366 days of issue at most, both ends included.
    expect(parsed({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(true);
    expect(parsed({ from: '2025-01-01', to: '2026-01-02' }).success).toBe(false);
    for (const unbounded of [
      {},
      { memberId: '7d3f9c1e-2b4a-4c6d-8e0f-1a2b3c4d5e6f' },
      { due: 'settled' },
      { due: 'open,settled' },
      { acceptance: 'accepted' },
      { acceptance: 'contested,contest_upheld' },
    ])
      expect(parsed(unbounded).success, JSON.stringify(unbounded)).toBe(false);
    for (const wrong of [
      { from: '2026-11-01' },
      { from: '2026-11-02', to: '2026-11-01' },
      { due: 'late' },
      { due: 'soon,soon' },
      { due: '' },
      { acceptance: 'pending,' },
      { period: '2026-10-02' },
    ])
      expect(parsed(wrong).success, JSON.stringify(wrong)).toBe(false);
  });

  it('export from one day to another, both included, two years at most', () => {
    expect(AccountingPeriodQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-01' }).success).toBe(
      true,
    );
    expect(AccountingPeriodQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(
      false,
    );
    // A first fiscal year of 24 months across a 29 February: 731 days.
    expect(ACCOUNTING_PERIOD_MAX_DAYS).toBe(731);
    expect(AccountingPeriodQuerySchema.safeParse({ from: '2024-01-01', to: '2025-12-31' }).success).toBe(
      true,
    );
    expect(AccountingPeriodQuerySchema.safeParse({ from: '2023-12-31', to: '2025-12-31' }).success).toBe(
      false,
    );
    expect(AccountingPeriodQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-31' }).success).toBe(
      false,
    );
    const journal = {
      fileName: 'journal-prestataires_20261101_20261115.txt',
      mediaType: ACCOUNTING_JOURNAL_MEDIA_TYPE,
      content: btoa('JournalCode\r\n'),
      entryCount: 0,
      unbalanced: [],
      transfersLeftOut: [],
    };
    expect(AccountingJournalSchema.safeParse(journal).success).toBe(true);
    // Never the name of the legal FEC, `<SIREN>FEC<AAAAMMJJ>.txt`.
    expect(
      AccountingJournalSchema.safeParse({ ...journal, fileName: '123456789FEC20261231.txt' }).success,
    ).toBe(false);
  });

  it('recap one calendar year, past or current, whose beneficiary is never exempt for more than paid', () => {
    const thisYear = new Date().getUTCFullYear();
    expect(Das2QuerySchema.parse({ year: String(thisYear) })).toEqual({ year: thisYear });
    expect(Das2QuerySchema.safeParse({ year: String(thisYear + 1) }).success).toBe(false);
    expect(Das2QuerySchema.safeParse({ year: String(DAS2_FIRST_YEAR) }).success).toBe(true);
    expect(Das2QuerySchema.safeParse({ year: String(DAS2_FIRST_YEAR - 1) }).success).toBe(false);
    for (const year of ['2026.5', 'deux mille', '', '2026-01-01'])
      expect(Das2QuerySchema.safeParse({ year }).success, year).toBe(false);

    const beneficiary = {
      memberId: invoice.memberId,
      identity: invoice.contractor,
      nature: 'commissions',
      paidMinor: 300_000,
      treatyExemptMinor: 300_000,
      warnings: [],
    };
    expect(Das2BeneficiarySchema.safeParse(beneficiary).success).toBe(true);
    expect(Das2BeneficiarySchema.safeParse({ ...beneficiary, treatyExemptMinor: 300_001 }).success).toBe(
      false,
    );
    expect(
      Das2BeneficiarySchema.safeParse({ ...beneficiary, identity: null, warnings: ['identity_missing'] })
        .success,
    ).toBe(true);
    expect(Das2BeneficiarySchema.safeParse({ ...beneficiary, warnings: ['unknown'] }).success).toBe(false);

    const recap = {
      year: 2026,
      fileName: 'das2-prestataires_2026.csv',
      mediaType: DAS2_MEDIA_TYPE,
      content: btoa('Nature;Montant\r\n'),
      beneficiaries: [beneficiary],
      notes: ['amounts_as_sent'],
    };
    expect(Das2ExportSchema.safeParse(recap).success).toBe(true);
    expect(Das2ExportSchema.safeParse({ ...recap, fileName: 'das2_2026.csv' }).success).toBe(false);
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
    // The reminder delay (lot 8): optional, kept when omitted, 1 to 120 whole days.
    expect(
      UpdateBillingSettingsBodySchema.parse({ ...body, documentReminderDays: 45 }).documentReminderDays,
    ).toBe(45);
    for (const documentReminderDays of [0, 121, 7.5])
      expect(UpdateBillingSettingsBodySchema.safeParse({ ...body, documentReminderDays }).success).toBe(
        false,
      );
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

  describe('Équipe › Régimes de facturation (lot 5b)', () => {
    /** An invented regime (ADR 0010): its words are the test's, never an accountant's. */
    const benin = {
      id: '0190a0b0-0000-7000-8000-000000000030',
      name: 'Bénin et Madagascar',
      countries: ['BJ', 'MG'],
      vat: { treatment: 'reverse_charge', rateBps: 2_000 },
      withholding: 'treaty_exempt',
      mentions: ['Autofacturation', 'Autoliquidation'],
      documents: ['tax_residence'],
      taxIdRequired: true,
    };
    const refused = (body: object): string[] => {
      const result = CreateBillingRegimeBodySchema.safeParse(body);
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    };

    it('takes a regime as the accountant wrote it, its validation and its assignment apart', () => {
      expect(CreateBillingRegimeBodySchema.parse(benin)).toEqual(benin);
      // Validated or dated by their own routes: the body says neither.
      expect(CreateBillingRegimeBodySchema.parse({ ...benin, validatedOn: '2026-11-01' })).toEqual(benin);
      const franchise = {
        ...benin,
        countries: ['FR'],
        vat: { treatment: 'exempt' },
        withholding: 'none',
        documents: ['urssaf_vigilance'],
      };
      expect(refused(franchise)).toEqual([]);
      expect(
        AssignContractorRegimeBodySchema.safeParse({
          id: '0190a0b0-0000-7000-8000-000000000031',
          regimeId: benin.id,
          from: '2026-11-16',
        }).success,
      ).toBe(true);
      expect(ValidateBillingRegimeBodySchema.safeParse({ validatedOn: '2026-02-30' }).success).toBe(false);
    });

    it('refuses a country or a document named twice, a treaty without the residence certificate', () => {
      expect(refused({ ...benin, countries: ['BJ', 'BJ'] })).toEqual(['countries']);
      expect(refused({ ...benin, documents: ['tax_residence', 'tax_residence'] })).toEqual(['documents']);
      expect(refused({ ...benin, documents: [] })).toEqual(['documents']);
      expect(refused({ ...benin, documents: ['urssaf_vigilance'] })).toEqual(['documents']);
      expect(refused({ ...benin, countries: [] })).toEqual(['countries']);
      expect(refused({ ...benin, vat: { treatment: 'charged', rateBps: 10_001 } })).toEqual(['vat.rateBps']);
      expect(refused({ ...benin, mentions: Array.from({ length: 25 }, () => 'Mention') })).toEqual([
        'mentions',
      ]);
    });
  });

  describe('Équipe › Pièces du prestataire (lot 5c)', () => {
    const certificate = {
      id: '0190a0b0-0000-7000-8000-000000000040',
      kind: 'tax_residence',
      issuedOn: '2026-03-03',
    };
    const refused = (query: object): string[] => {
      const result = UploadContractorDocumentQuerySchema.safeParse(query);
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    };

    it('takes a certificate of residence without an end: it holds for the calendar year of its issue', () => {
      expect(UploadContractorDocumentQuerySchema.parse(certificate)).toEqual(certificate);
      expect(refused({ ...certificate, validUntil: '2026-12-31' })).toEqual(['validUntil']);
      const vigilance = { ...certificate, kind: 'urssaf_vigilance' };
      expect(refused({ ...vigilance, validUntil: '2026-09-02' })).toEqual([]);
      expect(refused({ ...vigilance, validUntil: '2026-03-03' })).toEqual(['validUntil']);
      expect(refused({ ...vigilance, issuedOn: '2026-02-30' })).toEqual(['issuedOn']);
    });

    it('takes a check accepted, or refused with a reason of 1 to 500 characters, trimmed', () => {
      expect(ContractorDocumentReviewSchema.parse({ decision: 'accepted' })).toEqual({
        decision: 'accepted',
      });
      expect(ContractorDocumentReviewSchema.parse({ decision: 'refused', reason: '  Illisible.  ' })).toEqual(
        {
          decision: 'refused',
          reason: 'Illisible.',
        },
      );
      expect(ContractorDocumentReviewSchema.safeParse({ decision: 'refused' }).success).toBe(false);
      expect(ContractorDocumentReviewSchema.safeParse({ decision: 'refused', reason: '   ' }).success).toBe(
        false,
      );
      expect(
        ContractorDocumentReviewSchema.safeParse({ decision: 'refused', reason: 'x'.repeat(501) }).success,
      ).toBe(false);
      expect(CONTRACTOR_DOCUMENT_MEDIA_TYPES).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
    });

    it('lists the documents waiting for the check, and nothing else yet (lot 8)', () => {
      expect(ContractorDocumentsQuerySchema.parse({ review: 'pending' })).toEqual({ review: 'pending' });
      for (const query of [{}, { review: 'accepted' }, { review: 'pending,refused' }])
        expect(ContractorDocumentsQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
      const waiting = {
        id: certificate.id,
        memberId: '0190a0b0-0000-7000-8000-000000000041',
        kind: 'tax_residence',
        issuedOn: '2026-03-03',
        validUntil: null,
        lastDay: '2026-12-31',
        mediaType: 'application/pdf',
        sha256: 'a'.repeat(64),
        review: null,
        purgedAt: null,
        createdAt: '2026-03-04T08:00:00.000Z',
        displayName: 'Kofi',
      };
      const list = (count: number) => ({
        documents: Array.from({ length: count }, () => waiting),
        more: true,
      });
      expect(PendingContractorDocumentsSchema.safeParse(list(CONTRACTOR_DOCUMENTS_PENDING_MAX)).success).toBe(
        true,
      );
      expect(
        PendingContractorDocumentsSchema.safeParse(list(CONTRACTOR_DOCUMENTS_PENDING_MAX + 1)).success,
      ).toBe(false);
      expect(PendingContractorDocumentsSchema.safeParse(list(1)).success).toBe(true);
    });
  });
});
