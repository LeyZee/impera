import { BillingSettingsSchema, type BillingSettings } from '@nirvana/contracts';

/*
 * Réglages › Facturation as the screens of EQ-06 lot 8c read it: an invented agency (ADR 0010), 123 456 782 carrying a
 * right Luhn key and FR11 its VAT key.
 */

export const BILLING_SETTINGS: BillingSettings = BillingSettingsSchema.parse({
  agency: {
    legalName: 'Atelier Lumen',
    address: '12 rue des Exemples\n69002 Lyon',
    siren: '123456782',
    vatNumber: 'FR11123456782',
    legalForm: 'SAS',
    shareCapitalMinor: 1_000_000,
    rcsCity: 'Lyon',
  },
  paymentTerms:
    'Aucun escompte pour paiement anticipé. Pénalités : trois fois le taux légal. Indemnité : 40 €.',
  dueDays: 60,
  documentReminderDays: 30,
  fiscalYearEndMonth: 12,
  serviceDescription: 'Prestations de messagerie pour le compte de l’agence.',
  logoSha256: null,
  accounts: null,
  updatedAt: '2026-11-01T10:00:00.000Z',
});
