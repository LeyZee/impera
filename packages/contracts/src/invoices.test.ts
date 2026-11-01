import { describe, expect, it } from 'vitest';

import {
  BillingRegimeSchema,
  BillingSettingsSchema,
  DEFAULT_INVOICE_DUE_DAYS,
  INVOICE_ERROR_CODES,
  InvoiceNumberSchema,
  InvoicePrefixSchema,
  InvoiceSchema,
  RegimeVatSchema,
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
  lines: [{ kind: 'commission', label: 'Commission', detail: null, amountMinor: 12_000 }],
  totals: { exclVatMinor: 12_000, vatMinor: 0, inclVatMinor: 12_000, selfAssessedVatMinor: 2_400 },
  acceptance: { state: 'pending', deadline: '2026-11-24T09:00:00.000Z', reason: null },
  pdfSha256: null,
} as const;

describe('invoices', () => {
  it('give every error code a suffix that sets its status (api.md)', () => {
    for (const code of INVOICE_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|unprocessable|forbidden)$/u);
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
      accounts: { expense: '622', supplierPrefix: '401', vatDeductible: '44566', vatSelfAssessed: '4452' },
      updatedAt: '2026-10-31T09:00:00.000Z',
    });
    expect(DEFAULT_INVOICE_DUE_DAYS).toBe(60);
    for (const ok of [45, 60]) expect(BillingSettingsSchema.safeParse(settings(ok)).success).toBe(true);
    for (const wrong of [15, 44, 61, 90])
      expect(BillingSettingsSchema.safeParse(settings(wrong)).success).toBe(false);
  });
});
