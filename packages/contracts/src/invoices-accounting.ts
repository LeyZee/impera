import { z } from 'zod';

import { TeamMemberIdSchema } from './ids';
import { InvoicePrefixSchema } from './invoices-fields';
import { dayNumber } from './invoices-internal';
import { InvoiceContractorSchema } from './invoices-parties';
import { PayPeriodSchema } from './pay-periods';
import { CalendarDaySchema } from './team-members';

/**
 * The accounting exports (EQ-06): journal, archive, accounts and the DAS2.
 */

/** An accounting account as the accountant gives it, never written in the code. */
export const AccountCodeSchema = z.string().regex(/^[0-9A-Z]{1,20}$/u, 'Un compte : chiffres et majuscules');

/** A journal's code as the accountant gives it (the FEC's `JournalCode`), never written in the code. */
export const JournalCodeSchema = z
  .string()
  .regex(/^[0-9A-Z]{1,8}$/u, 'Un code de journal : chiffres et majuscules');

/**
 * The accounts and journals of the accounting export (EQ-06 lot 7b), each `null` until the accountant gives it: the
 * export refuses while one is missing (`journal_accounts_missing_unprocessable`), and never guesses one.
 *
 * - `expense`: the contractors' commissions, excluding VAT (a 6… account).
 * - `supplier`: the collective supplier account (401…); each contractor's own account is it followed by their prefix
 *   of numbers (`401` and `NORA` give `401NORA`).
 * - `vatDeductible`: the VAT a contractor charges, which the agency deducts (44566…).
 * - `vatSelfAssessedDeductible` and `vatSelfAssessedDue`: under reverse charge, the agency deducts (445662…) and owes
 *   (4452…) the same VAT; two different accounts, never one of the deductible ones for the VAT owed.
 * - `bank`: the account the transfers leave from (512…).
 * - `purchaseJournal` and `bankJournal`: the codes of the two journals, different.
 *
 * It is also the body of `PUT /v1/payroll/billing-settings/accounts`, the owner only: the other settings do not change,
 * and Réglages › Facturation must be saved first (`billing_settings_missing_conflict`).
 */
export const JournalAccountsSchema = z
  .object({
    expense: AccountCodeSchema.nullable(),
    supplier: AccountCodeSchema.nullable(),
    vatDeductible: AccountCodeSchema.nullable(),
    vatSelfAssessedDeductible: AccountCodeSchema.nullable(),
    vatSelfAssessedDue: AccountCodeSchema.nullable(),
    bank: AccountCodeSchema.nullable(),
    purchaseJournal: JournalCodeSchema.nullable(),
    bankJournal: JournalCodeSchema.nullable(),
  })
  .superRefine((accounts, context) => {
    const due = accounts.vatSelfAssessedDue;
    if (due !== null && (due === accounts.vatDeductible || due === accounts.vatSelfAssessedDeductible)) {
      context.addIssue({
        code: 'custom',
        path: ['vatSelfAssessedDue'],
        message: 'La TVA due ne va jamais sur un compte de TVA déductible.',
      });
    }
    if (accounts.purchaseJournal !== null && accounts.purchaseJournal === accounts.bankJournal) {
      context.addIssue({
        code: 'custom',
        path: ['bankJournal'],
        message: 'Le journal de banque a un autre code que celui des achats.',
      });
    }
  });
export type JournalAccounts = z.infer<typeof JournalAccountsSchema>;

/** The names of the export's accounts and journals, in their one order: a refusal lists those missing in it. */
export const JOURNAL_ACCOUNT_NAMES = [
  'expense',
  'supplier',
  'vatDeductible',
  'vatSelfAssessedDeductible',
  'vatSelfAssessedDue',
  'bank',
  'purchaseJournal',
  'bankJournal',
] as const satisfies readonly (keyof JournalAccounts)[];
export const JournalAccountNameSchema = z.enum(JOURNAL_ACCOUNT_NAMES);
export type JournalAccountName = z.infer<typeof JournalAccountNameSchema>;

/** The longest range one export reads: two years, a first fiscal year lasting up to 24 months. */
export const ACCOUNTING_PERIOD_MAX_DAYS = 731;

/**
 * The range of an export, the owner only, from `from` to `to`, both included: the contractors' journal of the
 * documents issued and the transfers made (`GET /v1/payroll/accounting/journal?from=…&to=…`, EQ-06 lot 7b), the
 * archive of the documents' PDFs (`GET /v1/payroll/accounting/archive?from=…&to=…`, lot 7d).
 */
export const AccountingPeriodQuerySchema = z
  .object({ from: CalendarDaySchema, to: CalendarDaySchema })
  .refine((query) => query.from <= query.to, { message: 'La fin suit le début', path: ['to'] })
  .refine((query) => dayNumber(query.to) - dayNumber(query.from) < ACCOUNTING_PERIOD_MAX_DAYS, {
    message: 'Deux ans au plus',
    path: ['to'],
  });
export type AccountingPeriodQuery = z.infer<typeof AccountingPeriodQuerySchema>;

/** The FEC's encoding: the file's bytes are ISO 8859-15. */
export const ACCOUNTING_JOURNAL_MEDIA_TYPE = 'text/plain; charset=ISO-8859-15';

/**
 * The journal export: the file's name (never the legal FEC's, `<SIREN>FEC<AAAAMMJJ>.txt`), its bytes in base64, how
 * many entries it holds, the settled groups left without a letter because their lines do not add up (a contractor
 * who charges VAT is invoiced including VAT and paid as the statement says), by contractor's prefix and the period of
 * the statement that settles them, and the transfers it could not write.
 */
export const AccountingJournalSchema = z.object({
  fileName: z.string().regex(/^journal-prestataires_\d{8}_\d{8}\.txt$/u),
  mediaType: z.literal(ACCOUNTING_JOURNAL_MEDIA_TYPE),
  content: z.base64(),
  entryCount: z.number().int().min(0),
  unbalanced: z.array(z.object({ prefix: InvoicePrefixSchema, period: PayPeriodSchema })),
  /**
   * The transfers in the range left out of the file: their contractor has no document, hence no supplier account (a
   * transfer recorded before pay asked for its invoice, ADR 0041).
   */
  transfersLeftOut: z.array(z.object({ memberId: TeamMemberIdSchema, period: PayPeriodSchema })),
});
export type AccountingJournal = z.infer<typeof AccountingJournalSchema>;

/** The archive's media type: its bytes are streamed, never in JSON. */
export const ACCOUNTING_ARCHIVE_MEDIA_TYPE = 'application/zip';

/** The first year a DAS2 recap reads. */
export const DAS2_FIRST_YEAR = 2000;

/**
 * `GET /v1/payroll/accounting/das2?year=…`, the owner only (EQ-06 lot 7c): the calendar year of the transfers, a past
 * one or the current one (by the UTC clock: on the night of 1 January, the new year waits an hour or two).
 */
export const Das2QuerySchema = z.object({
  year: z.coerce
    .number()
    .int()
    .min(DAS2_FIRST_YEAR)
    .refine((year) => year <= new Date().getUTCFullYear(), { message: 'Une année passée ou en cours' }),
});
export type Das2Query = z.infer<typeof Das2QuerySchema>;

/**
 * What the accountant checks on a beneficiary before declaring it:
 *
 * - `identity_missing`: no invoice to read their identity from (a transfer recorded before pay waited for its invoice);
 * - `profile_changed`: their file differs today from the identity their invoice froze, which the recap keeps;
 * - `transfer_without_invoice`: a transfer of the year paid no invoice, so its treaty exemption is not known;
 * - `regimes_mixed`: a transfer paid invoices under two withholdings, so it is left out of the treaty exempt part;
 * - `vat_charged`: an invoice they were paid charged VAT, while the transfer sent what the statement says, excluding VAT.
 */
export const DAS2_WARNINGS = [
  'identity_missing',
  'profile_changed',
  'transfer_without_invoice',
  'regimes_mixed',
  'vat_charged',
] as const;
export const Das2WarningSchema = z.enum(DAS2_WARNINGS);
export type Das2Warning = z.infer<typeof Das2WarningSchema>;

/** What a beneficiary was paid for, as the DAS2 names it. */
export const DAS2_NATURES = ['commissions'] as const;

/**
 * A beneficiary of the DAS2 (art. 240 of the CGI): a contractor paid more than 2 400 € in the calendar year, by the day
 * of the transfers; the identity their latest invoice of the year froze; how much was sent, and how much of it paid
 * invoices under a regime whose tax treaty sets the 182 B withholding aside.
 */
export const Das2BeneficiarySchema = z
  .object({
    memberId: TeamMemberIdSchema,
    identity: InvoiceContractorSchema.nullable(),
    nature: z.enum(DAS2_NATURES),
    paidMinor: z.number().int().min(0),
    treatyExemptMinor: z.number().int().min(0),
    warnings: z.array(Das2WarningSchema),
  })
  .refine((beneficiary) => beneficiary.treatyExemptMinor <= beneficiary.paidMinor, {
    message: 'La part sous convention ne dépasse pas le montant versé',
    path: ['treatyExemptMinor'],
  });
export type Das2Beneficiary = z.infer<typeof Das2BeneficiarySchema>;

/** What the recap always recalls: its amounts are what was sent, by the day of the transfer, never what was invoiced. */
export const DAS2_NOTES = ['amounts_as_sent'] as const;

/** The recap's file: a CSV the accountant opens in a spreadsheet. */
export const DAS2_MEDIA_TYPE = 'text/csv; charset=utf-8';

/** The DAS2 recap: its file in base64, and its lines as numbers for the screen and the tests. */
export const Das2ExportSchema = z.object({
  year: z.number().int().min(DAS2_FIRST_YEAR),
  fileName: z.string().regex(/^das2-prestataires_\d{4}\.csv$/u),
  mediaType: z.literal(DAS2_MEDIA_TYPE),
  content: z.base64(),
  beneficiaries: z.array(Das2BeneficiarySchema),
  notes: z.array(z.enum(DAS2_NOTES)),
});
export type Das2Export = z.infer<typeof Das2ExportSchema>;
