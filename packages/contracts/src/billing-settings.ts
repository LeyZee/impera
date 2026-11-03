import { z } from 'zod';

import { BillingRegimeIdSchema, ContractorRegimeIdSchema } from './ids';
import { JournalAccountsSchema } from './invoices-accounting';
import {
  AGENCY_LEGAL_FORM_MAX,
  DOCUMENT_REMINDER_MAX_DAYS,
  INVOICE_DUE_MAX_DAYS,
  INVOICE_DUE_MIN_DAYS,
  PaymentTermsSchema,
  RCS_CITY_MAX,
  ServiceDescriptionSchema,
  Sha256Schema,
  frenchVatNumberOf,
  sirenChecksOut,
} from './invoices-fields';
import { trimmed } from './invoices-internal';
import { AgencyLogoSchema, BillingRegimeSchema, InvoiceAgencySchema } from './invoices-parties';
import { CalendarDaySchema } from './team-members';

/**
 * The agency's billing settings and the regimes through the routes (EQ-06): bodies, params and views.
 */

/** The agency's billing settings: its identity and payment terms on each invoice, the delays, the journal's accounts. */
export const BillingSettingsSchema = z.object({
  agency: InvoiceAgencySchema,
  paymentTerms: PaymentTermsSchema,
  dueDays: z.number().int().min(INVOICE_DUE_MIN_DAYS).max(INVOICE_DUE_MAX_DAYS),
  documentReminderDays: z.number().int().min(1).max(DOCUMENT_REMINDER_MAX_DAYS),
  fiscalYearEndMonth: z.number().int().min(1).max(12),
  /** Without it, no invoice is issued (`agency_missing`). */
  serviceDescription: ServiceDescriptionSchema.nullable(),
  /** The fingerprint of the logo each document prints in its head, `null` for none. */
  logoSha256: Sha256Schema.nullable(),
  /** The export's accounts and journals, `null` until first given: the export never leaves without them. */
  accounts: JournalAccountsSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type BillingSettings = z.infer<typeof BillingSettingsSchema>;

/**
 * Réglages › Facturation as the owner reads it: the settings, `null` until first saved (no invoice is issued until
 * then, `agency_missing`), and the facts of the logo they name.
 */
export const BillingSettingsViewSchema = z.object({
  settings: BillingSettingsSchema.nullable(),
  logo: AgencyLogoSchema.nullable(),
});
export type BillingSettingsView = z.infer<typeof BillingSettingsViewSchema>;

/**
 * The agency as the owner sets it: what an invoice prints, its foot included. The legal form, the share capital and the
 * town of the trade register are optional in a copy made before lot 4, never in a setting saved from now on (art.
 * R123-237 of the Code de commerce). The SIREN carries its check key, and the VAT number is the one this SIREN gives
 * (`frenchVatNumberOf`): a copy already made is read as it is, a setting saved from now on is checked.
 */
export const BillingAgencyBodySchema = InvoiceAgencySchema.extend({
  legalForm: trimmed(AGENCY_LEGAL_FORM_MAX),
  shareCapitalMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  rcsCity: trimmed(RCS_CITY_MAX),
}).superRefine((agency, context) => {
  // A typo in either number would be printed on every invoice from now on: both are checked before they are saved.
  if (!sirenChecksOut(agency.siren)) {
    context.addIssue({
      code: 'custom',
      path: ['siren'],
      message: 'Ce numéro n’est pas un SIREN : sa clé de contrôle (le dernier chiffre) ne correspond pas.',
    });
    return;
  }
  const expected = frenchVatNumberOf(agency.siren);
  if (agency.vatNumber !== expected) {
    context.addIssue({
      code: 'custom',
      path: ['vatNumber'],
      message: `Le numéro de TVA intracommunautaire de ce SIREN est ${expected}.`,
    });
  }
});
export type BillingAgencyBody = z.infer<typeof BillingAgencyBodySchema>;

/**
 * `PUT /v1/payroll/billing-settings`, the owner only: what every invoice issued from now on copies. An invoice issued
 * before keeps its own copy, its PDF never changes. The logo is one the owner added before (`POST …/logos`), or `null`
 * for none; the accounts are set elsewhere (`…/accounts`) and kept. `documentReminderDays` (lot 8), 1 to 120 days, is
 * how long before a document's last day its reminder starts (the tax residence certificate keeps the 1st of December):
 * omitted, the saved delay is kept, `DEFAULT_DOCUMENT_REMINDER_DAYS` at the first save.
 */
export const UpdateBillingSettingsBodySchema = z.object({
  agency: BillingAgencyBodySchema,
  serviceDescription: ServiceDescriptionSchema,
  paymentTerms: PaymentTermsSchema,
  dueDays: z.number().int().min(INVOICE_DUE_MIN_DAYS).max(INVOICE_DUE_MAX_DAYS),
  fiscalYearEndMonth: z.number().int().min(1).max(12),
  logoSha256: Sha256Schema.nullable(),
  documentReminderDays: z.number().int().min(1).max(DOCUMENT_REMINDER_MAX_DAYS).optional(),
});
export type UpdateBillingSettingsBody = z.infer<typeof UpdateBillingSettingsBodySchema>;

/**
 * `POST /v1/payroll/billing-regimes`, the owner only (EQ-06 lot 5b): a regime as the agency's accountant wrote it, for
 * one or more countries. Never changed once written: a new text is a new regime, assigned from a day on. The same `id`
 * sent again with the same regime gives it back; with another, `billing_regime_id_conflict`. Two rules of the code, not
 * of a regime's text: a country or a document named twice says nothing more, and a regime that sets the 182 B
 * withholding aside by a tax treaty asks for the tax residence certificate, without which the treaty does not apply
 * (the accountant's answer of 01/11, Charles's choice (a)).
 */
export const CreateBillingRegimeBodySchema = BillingRegimeSchema.omit({ validatedOn: true, createdAt: true })
  .refine((regime) => new Set(regime.countries).size === regime.countries.length, {
    path: ['countries'],
    message: 'Un pays n’est nommé qu’une fois.',
  })
  .refine((regime) => new Set(regime.documents).size === regime.documents.length, {
    path: ['documents'],
    message: 'Une pièce n’est demandée qu’une fois.',
  })
  .refine((regime) => regime.withholding !== 'treaty_exempt' || regime.documents.includes('tax_residence'), {
    path: ['documents'],
    message:
      'La convention n’écarte la retenue qu’avec l’attestation de résidence fiscale : le régime la demande.',
  });
export type CreateBillingRegimeBody = z.infer<typeof CreateBillingRegimeBodySchema>;

/** `GET /v1/payroll/billing-regimes`, any member: every regime, the newest first, with the day it was validated. */
export const BillingRegimesSchema = z.object({ regimes: z.array(BillingRegimeSchema) });
export type BillingRegimes = z.infer<typeof BillingRegimesSchema>;

export const BillingRegimeParamsSchema = z.object({ regimeId: BillingRegimeIdSchema });

/**
 * `POST /v1/payroll/billing-regimes/:regimeId/validation`, the owner only: the day the accountant validated the regime,
 * recorded once and never ahead of today in the agency's zone (`billing_regime_validation_future_unprocessable`). The
 * same day sent again gives the regime back; another day, `billing_regime_validated_conflict`. Every statement whose
 * invoice waited is tried again (`payroll.requeue_invoice_issues`).
 */
export const ValidateBillingRegimeBodySchema = z.object({ validatedOn: CalendarDaySchema });
export type ValidateBillingRegimeBody = z.infer<typeof ValidateBillingRegimeBodySchema>;

/**
 * `POST /v1/payroll/contractors/:memberId/regimes`, the owner only: the contractor's regime from `from` on, today at the
 * earliest and after his last one (`billing_regime_backdated_unprocessable`), a regime of his country
 * (`billing_regime_country_unprocessable`). The same `id` sent again with the same values gives it back; with others,
 * `contractor_regime_id_conflict`. His waiting statements are tried again on that day: at once from today, at the
 * first minute of `from` in the agency's zone otherwise.
 */
export const AssignContractorRegimeBodySchema = z.object({
  id: ContractorRegimeIdSchema,
  regimeId: BillingRegimeIdSchema,
  from: CalendarDaySchema,
});
export type AssignContractorRegimeBody = z.infer<typeof AssignContractorRegimeBodySchema>;
