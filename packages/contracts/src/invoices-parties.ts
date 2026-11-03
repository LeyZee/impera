import { z } from 'zod';

import { BillingRegimeIdSchema, ContractorRegimeIdSchema, TeamMemberIdSchema } from './ids';
import {
  AGENCY_LEGAL_FORM_MAX,
  BusinessIdSchema,
  INVOICE_MENTIONS_MAX,
  InvoiceMentionSchema,
  LEGAL_NAME_MAX,
  POSTAL_ADDRESS_MAX,
  RCS_CITY_MAX,
  REGIME_NAME_MAX,
  Sha256Schema,
  TAX_ID_MAX,
  VatNumberSchema,
} from './invoices-fields';
import { trimmed } from './invoices-internal';
import { ContractorDocumentKindSchema, RegimeVatSchema, WithholdingSchema } from './invoices-vocabulary';
import { CountryCodeSchema } from './team';
import { CalendarDaySchema } from './team-members';

/**
 * The parties an invoice copies at its issue (EQ-06, ADR 0036): the agency and its logo, the contractor, the regimes,
 * the footer.
 */

/**
 * The agency's logo, a setting kept by its fingerprint (EQ-06 lot 4): a PNG of at most 512 KB, transparent so that it
 * sits on the white page. Neither a JPEG (no transparency, CMYK breaks PDF/A) nor an SVG (PDFKit draws none, and an
 * extra library would put PDF/A in doubt).
 */
export const AGENCY_LOGO_MEDIA_TYPES = ['image/png'] as const;
export const AGENCY_LOGO_MAX_BYTES = 512 * 1024;
/**
 * A logo's sides, in pixels: at least 64 (smaller, it is a smudge), at most 4 000, and 4 million pixels in all, so that
 * checking each pixel of a 512 KB file never takes the server more than a few dozen megabytes.
 */
export const AGENCY_LOGO_MIN_SIDE = 64;
export const AGENCY_LOGO_MAX_SIDE = 4000;
export const AGENCY_LOGO_MAX_PIXELS = 4_000_000;
/**
 * The head of a document prints the logo about 12 mm high: under 150 pixels high it is printed under 300 dpi and may
 * look blurred. A warning on the screen, never a refusal.
 */
export const AGENCY_LOGO_SHARP_HEIGHT = 150;
/**
 * Why a logo is refused, checked by the server before it is kept: heavier than `AGENCY_LOGO_MAX_BYTES`, not a PNG,
 * a PNG damaged or cut short, without a single transparent pixel (its background would print as a box), or sides out of
 * bounds.
 */
export const AGENCY_LOGO_REFUSALS = ['too_heavy', 'not_png', 'damaged', 'opaque', 'dimensions'] as const;

export const AgencyLogoMediaTypeSchema = z.enum(AGENCY_LOGO_MEDIA_TYPES);
export type AgencyLogoMediaType = z.infer<typeof AgencyLogoMediaTypeSchema>;

export const AgencyLogoRefusalSchema = z.enum(AGENCY_LOGO_REFUSALS);
export type AgencyLogoRefusal = z.infer<typeof AgencyLogoRefusalSchema>;

/** A logo the agency added, kept by its fingerprint and never changed (`agency_logos`), as the screen shows it. */
export const AgencyLogoSchema = z.object({
  sha256: Sha256Schema,
  mediaType: AgencyLogoMediaTypeSchema,
  width: z.number().int().min(AGENCY_LOGO_MIN_SIDE).max(AGENCY_LOGO_MAX_SIDE),
  height: z.number().int().min(AGENCY_LOGO_MIN_SIDE).max(AGENCY_LOGO_MAX_SIDE),
  byteLength: z.number().int().min(1).max(AGENCY_LOGO_MAX_BYTES),
});
export type AgencyLogo = z.infer<typeof AgencyLogoSchema>;

/** `GET …/billing-settings/logos/:sha256`: a logo's bytes, by its fingerprint. */
export const AgencyLogoParamsSchema = z.object({ sha256: Sha256Schema });

/**
 * A billing regime, as the owner sets it and the accountant validates it, for one or more countries (Benin and
 * Madagascar share one). Never changed once written: a new text is a new regime, assigned from a day on.
 */
export const BillingRegimeSchema = z.object({
  id: BillingRegimeIdSchema,
  name: trimmed(REGIME_NAME_MAX),
  countries: z.array(CountryCodeSchema).min(1),
  vat: RegimeVatSchema,
  withholding: WithholdingSchema,
  mentions: z.array(InvoiceMentionSchema).max(INVOICE_MENTIONS_MAX),
  documents: z.array(ContractorDocumentKindSchema),
  taxIdRequired: z.boolean(),
  /** The day the accountant validated it, recorded by the owner; a regime not validated issues no invoice. */
  validatedOn: CalendarDaySchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type BillingRegime = z.infer<typeof BillingRegimeSchema>;

/** A contractor's regime from a day on: a change applies from a date, never backwards. */
export const ContractorRegimeSchema = z.object({
  id: ContractorRegimeIdSchema,
  memberId: TeamMemberIdSchema,
  regimeId: BillingRegimeIdSchema,
  from: CalendarDaySchema,
  createdAt: z.iso.datetime(),
});
export type ContractorRegime = z.infer<typeof ContractorRegimeSchema>;

/**
 * The contractor as his invoice prints him, copied at the issue. A contractor established in France adds his SIREN or
 * SIRET, his VAT number when he charges VAT, and « EI » after his name when he is an individual entrepreneur (art.
 * L526-22 and R526-27 of the Code de commerce); a company adds its legal form, its share capital and the town of its
 * trade register (art. R123-237). Those are absent from a copy made before they existed (lot 4, then the accountant's
 * answers of 01/11): a frozen copy is printed as it was written.
 */
export const InvoiceContractorSchema = z.object({
  legalName: trimmed(LEGAL_NAME_MAX),
  address: trimmed(POSTAL_ADDRESS_MAX),
  country: CountryCodeSchema,
  taxId: trimmed(TAX_ID_MAX).nullable(),
  businessId: BusinessIdSchema.nullable().optional(),
  vatNumber: VatNumberSchema.nullable().optional(),
  individualEntrepreneur: z.boolean().optional(),
  legalForm: trimmed(AGENCY_LEGAL_FORM_MAX).nullable().optional(),
  shareCapitalMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  rcsCity: trimmed(RCS_CITY_MAX).nullable().optional(),
});
export type InvoiceContractor = z.infer<typeof InvoiceContractorSchema>;

/**
 * The agency as each invoice prints it, a setting copied at the issue: never written in the code. Its legal form,
 * share capital and trade-register town go in the invoice's foot (art. R123-237 of the Code de commerce); absent from
 * a copy made before lot 4.
 */
export const InvoiceAgencySchema = z.object({
  legalName: trimmed(LEGAL_NAME_MAX),
  address: trimmed(POSTAL_ADDRESS_MAX),
  siren: z.string().regex(/^[0-9]{9}$/u, 'Neuf chiffres'),
  vatNumber: VatNumberSchema,
  legalForm: trimmed(AGENCY_LEGAL_FORM_MAX).nullable().optional(),
  shareCapitalMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  rcsCity: trimmed(RCS_CITY_MAX).nullable().optional(),
});
export type InvoiceAgency = z.infer<typeof InvoiceAgencySchema>;

const WHOLE_EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** A postal address as written, one printed line per line of it: blank lines and the spaces around each dropped. */
export const addressLines = (address: string): string[] =>
  address
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** « 10 000 € », « 1 000,50 € »: a share capital as an invoice prints it, the cents only when there are some. */
export const shareCapitalWords = (minor: number): string =>
  minor % 100 === 0 ? WHOLE_EUROS.format(minor / 100) : EUROS.format(minor / 100);

/**
 * « SAS au capital de 10 000 € », the form alone without a capital, `null` without a form (a copy made before lot 4, an
 * individual contractor): the agency's or a company contractor's.
 */
export function legalFormWords(company: {
  readonly legalForm?: string | null | undefined;
  readonly shareCapitalMinor?: number | null | undefined;
}): string | null {
  const form = company.legalForm ?? null;
  const capital = company.shareCapitalMinor ?? null;
  if (form === null) return null;
  return capital === null ? form : `${form} au capital de ${shareCapitalWords(capital)}`;
}

/** « 123 456 789 »: a SIREN in its three groups, which never break apart. */
export const sirenWords = (siren: string): string =>
  [siren.slice(0, 3), siren.slice(3, 6), siren.slice(6)].join('\u00a0');

/**
 * « RCS Lyon 123 456 789 » (art. R123-237 of the Code de commerce): the register's town and the SIREN, the first nine
 * digits of a SIRET, which never break apart.
 */
export const rcsWords = (city: string, businessId: string): string =>
  `RCS\u00a0${city}\u00a0${sirenWords(businessId.slice(0, 9))}`;

/**
 * The foot of each page of an invoice or a credit note (art. R123-237 of the Code de commerce): the agency and its
 * address, its form and capital, its register and SIREN, and what it is to the contractor. One text, which the PDF
 * prints and Réglages › Facturation shows: the owner reads there what the contractor will.
 */
export function invoiceFooterOf(agency: InvoiceAgency): string {
  const parts = [`Document établi par ${agency.legalName}, ${addressLines(agency.address).join(', ')}`];
  const form = legalFormWords(agency);
  if (form !== null) parts.push(form);
  if (agency.rcsCity !== undefined && agency.rcsCity !== null) {
    // The register and its number never break apart either.
    parts.push(rcsWords(agency.rcsCity, agency.siren));
  }
  return `${parts.join(' · ')}, mandataire de facturation du prestataire.`;
}
