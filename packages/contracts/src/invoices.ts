import { z } from 'zod';

import {
  BillingRegimeIdSchema,
  CommissionStatementIdSchema,
  ContractAcceptanceIdSchema,
  ContractorDocumentIdSchema,
  ContractorRegimeIdSchema,
  ContractTextIdSchema,
  InvoiceEventIdSchema,
  InvoiceIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from './ids';
import { PAY_AMOUNT_MAX_MINOR } from './money';
import { PayPeriodSchema } from './pay-periods';
import { BasisPointsSchema, CountryCodeSchema } from './team';
import { CalendarDaySchema } from './team-members';

/**
 * Contractors' invoices (EQ-06, ADR 0023 § Factures, ADR 0036): what the base keeps of a self-billed invoice, its
 * credit notes, the regime it copies, the contractor's file and the texts he accepts. An issued invoice never changes:
 * every party, mention and line is copied into it at its issue. The bodies of the routes come with the routes (lots 3
 * to 8); this file holds what the tables store and how a reader reads it.
 */

/** An invoice, or a credit note that cites one: both numbered in the contractor's one sequence. */
export const INVOICE_KINDS = ['invoice', 'credit_note'] as const;
export const InvoiceKindSchema = z.enum(INVOICE_KINDS);
export type InvoiceKind = z.infer<typeof InvoiceKindSchema>;

/**
 * What a line is: a commission per account, the team share, the bonuses, a penalty as a deduction the contract
 * provides for and the cap that gives part of them back, an adjustment with its period, and on a credit note a
 * reduction or a period's negative balance (ADR 0036).
 */
export const INVOICE_LINE_KINDS = [
  'commission',
  'team_share',
  'tier_bonus',
  'collective_bonus',
  'bonus',
  'penalty',
  'penalty_cap',
  'adjustment',
  'reduction',
  'negative_period',
] as const;
export const InvoiceLineKindSchema = z.enum(INVOICE_LINE_KINDS);
export type InvoiceLineKind = z.infer<typeof InvoiceLineKindSchema>;

/**
 * How VAT goes on an invoice of the regime. `reverse_charge`: the agency self-assesses it (art. 283-2 of the CGI),
 * nothing is invoiced and the rate serves the purchase journal. `exempt`: the contractor is under the franchise
 * (art. 293 B of the CGI). `charged`: the contractor charges VAT at the rate.
 */
export const VAT_TREATMENTS = ['reverse_charge', 'exempt', 'charged'] as const;
export const RegimeVatSchema = z.discriminatedUnion('treatment', [
  z.object({ treatment: z.literal('reverse_charge'), rateBps: BasisPointsSchema }),
  z.object({ treatment: z.literal('exempt') }),
  z.object({ treatment: z.literal('charged'), rateBps: BasisPointsSchema }),
]);
export type RegimeVat = z.infer<typeof RegimeVatSchema>;

/** The 182 B withholding: set aside by the tax treaty with the contractor's country, or not due at all. */
export const WITHHOLDINGS = ['treaty_exempt', 'none'] as const;
export const WithholdingSchema = z.enum(WITHHOLDINGS);

/** A document a regime asks of the contractor: the tax residence certificate, or the URSSAF one (vigilance). */
export const CONTRACTOR_DOCUMENT_KINDS = ['tax_residence', 'urssaf_vigilance'] as const;
export const ContractorDocumentKindSchema = z.enum(CONTRACTOR_DOCUMENT_KINDS);
export type ContractorDocumentKind = z.infer<typeof ContractorDocumentKindSchema>;

/** The two texts a contractor accepts before his first invoice: the service contract and the billing mandate. */
export const CONTRACT_TEXT_KINDS = ['service_contract', 'billing_mandate'] as const;
export const ContractTextKindSchema = z.enum(CONTRACT_TEXT_KINDS);
export type ContractTextKind = z.infer<typeof ContractTextKindSchema>;

/** Where an invoice or a credit note stands with its contractor (glossary « Acceptation d'une facture »). */
export const INVOICE_ACCEPTANCE_STATES = [
  'pending',
  'accepted',
  'tacitly_accepted',
  'contested',
  /** The owner upheld the contest, and pay corrects it (ADR 0039 § 3). */
  'contest_upheld',
  'contest_refused',
] as const;
export const InvoiceAcceptanceStateSchema = z.enum(INVOICE_ACCEPTANCE_STATES);
export type InvoiceAcceptanceState = z.infer<typeof InvoiceAcceptanceStateSchema>;

/** A step of an invoice's life, each dated in `invoice_events`, added only. */
export const INVOICE_EVENT_KINDS = [
  'issued',
  'accepted',
  'contested',
  'lapsed',
  'contest_upheld',
  'contest_refused',
  'paid',
] as const;
export const InvoiceEventKindSchema = z.enum(INVOICE_EVENT_KINDS);
export type InvoiceEventKind = z.infer<typeof InvoiceEventKindSchema>;

/**
 * Why a document a validated statement makes due is not issued (EQ-06): its invoice, for want of an accepted mandate,
 * of a regime the accountant validated and written for the contractor's country, of a full identity the owner checked,
 * under a tax treaty of a tax residence certificate the owner accepted, of a prefix or of the agency's identity;
 * a credit note the period owes, when no invoice can take it whole (ADR 0036). The statement stays validated and the
 * owner is told (`invoice_not_issued`).
 */
export const INVOICE_NOT_ISSUED_REASONS = [
  'no_mandate',
  'no_regime',
  'regime_not_validated',
  /**
   * The regime in force is not one of the country the contractor's member record now gives: changed since the regime
   * was given (« ok pays », Charles, 01/11). The owner gives him a regime of his country.
   */
  'regime_country_mismatch',
  'identity_incomplete',
  /** The file is complete, but the owner has not checked it, or a change of identity cleared his check (EQ-06). */
  'identity_unverified',
  /**
   * Under a regime whose tax treaty sets the 182 B withholding aside, no tax residence certificate of the period's
   * calendar year, or only refused ones: the agency never withholds 25 % (Charles's choice (a), lot 5c).
   */
  'tax_residence_missing',
  /** A tax residence certificate of the period's year is filed and waits for the owner's check (lot 5c). */
  'tax_residence_unverified',
  'prefix_missing',
  'agency_missing',
  'no_invoice_to_credit',
] as const;
export const InvoiceNotIssuedReasonSchema = z.enum(INVOICE_NOT_ISSUED_REASONS);
export type InvoiceNotIssuedReason = z.infer<typeof InvoiceNotIssuedReasonSchema>;

/** A contractor's prefix: two to eight capitals or digits, his own, frozen at his first invoice. */
export const INVOICE_PREFIX_PATTERN = '^[A-Z0-9]{2,8}$';
export const InvoicePrefixSchema = z
  .string()
  .regex(new RegExp(INVOICE_PREFIX_PATTERN, 'u'), 'Deux à huit majuscules ou chiffres');

/** `PRÉFIXE-AAAA-NNNN`: the sequence starts again at 1 each year and grows past four digits without being cut. */
export const INVOICE_NUMBER_PATTERN = '^[A-Z0-9]{2,8}-[0-9]{4}-[0-9]{4,}$';
export const InvoiceNumberSchema = z.string().regex(new RegExp(INVOICE_NUMBER_PATTERN, 'u'));

/** A SHA-256 in lowercase hexadecimal: a contract text, a document, a rendered PDF. */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);

/**
 * Where a file lies in the object storage, never on the server's disk: the same `storage_key` as a medium (ADR 0030),
 * in the bucket kept ten years with the invoices (ADR 0028), with the file's SHA-256 beside it.
 */
export const STORAGE_KEY_MAX = 512;
export const StorageKeySchema = z.string().min(1).max(STORAGE_KEY_MAX);

/** The longest texts the base keeps of a contractor and of a regime. */
export const LEGAL_NAME_MAX = 160;
export const POSTAL_ADDRESS_MAX = 400;
export const TAX_ID_MAX = 40;
export const BILLING_EMAIL_MAX = 254;
export const REGIME_NAME_MAX = 80;
export const INVOICE_MENTION_MAX = 400;
export const INVOICE_MENTIONS_MAX = 24;
/**
 * A document prints its regime's mentions and at most two of its own: an invoice its payment terms after them (art.
 * L441-9 of the Code de commerce), a credit note the invoice it cites before them (ADR 0036), a corrective invoice
 * both, the invoice it bills again before them and its payment terms after (ADR 0040).
 */
export const INVOICE_DOCUMENT_MENTIONS_MAX = INVOICE_MENTIONS_MAX + 2;
/**
 * The agency's payment terms, a setting: an invoice prints them after its due date, in one mention (« Échéance : » and
 * the longest date take 30 characters of its 400).
 */
export const PAYMENT_TERMS_MAX = 360;
/**
 * What the agency sells, as each invoice designates it above its lines (art. 242 nonies A of annex II to the CGI: « la
 * dénomination précise des services rendus »): a setting its accountant validates, copied into each invoice.
 */
export const SERVICE_DESCRIPTION_MAX = 400;
/** The agency's legal form as its documents print it (« SAS »), and the town of its trade register (R123-237). */
export const AGENCY_LEGAL_FORM_MAX = 40;
export const RCS_CITY_MAX = 60;
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
export const INVOICE_LINE_LABEL_MAX = 200;
export const INVOICE_LINE_DETAIL_MAX = 400;
export const INVOICE_REASON_MAX = 500;
export const CONTRACT_TEXT_MAX = 100_000;

/** The mandate's delay to contest, in whole days (7 by default, ADR 0023 § Factures). */
export const DEFAULT_CONTEST_DELAY_DAYS = 7;
export const CONTEST_DELAY_MAX_DAYS = 60;
/**
 * An invoice falls due this many days after its issue (a setting), never more than 60: the most a payment term agreed
 * between professionals may run from the invoice's date (art. L441-10 of the Code de commerce). Never less than 45
 * either: a positive amount is carried twice at most and paid by the third fortnight, which must fall before the due
 * date of the first invoice (ADR 0038).
 */
export const DEFAULT_INVOICE_DUE_DAYS = 60;
export const INVOICE_DUE_MIN_DAYS = 45;
export const INVOICE_DUE_MAX_DAYS = 60;
/**
 * The month the agency's fiscal year closes, on its last day (a setting its accountant confirms): the calendar year by
 * default. It fixes how long each invoice's PDF stays locked (ADR 0037 § 4).
 */
export const DEFAULT_FISCAL_YEAR_END_MONTH = 12;
/** An invoice is kept ten years after the close of its fiscal year (art. L123-22 of the Code de commerce). */
export const INVOICE_RETENTION_YEARS = 10;
/**
 * Where the second copy of each PDF is kept, at a provider that shares nothing with the first bucket's (ADR 0037 § 6).
 * One row per copy in `invoice_pdf_copies`: a third provider, one day, is one more value here.
 */
export const INVOICE_PDF_COPY_PROVIDERS = ['ovhcloud'] as const;
export const InvoicePdfCopyProviderSchema = z.enum(INVOICE_PDF_COPY_PROVIDERS);
export type InvoicePdfCopyProvider = z.infer<typeof InvoicePdfCopyProviderSchema>;
/** Where a PDF was found missing or different: the first bucket (Hetzner) or a copy (ADR 0037 § 5 to 7). */
export const INVOICE_PDF_PLACES = ['primary', ...INVOICE_PDF_COPY_PROVIDERS] as const;
export const InvoicePdfPlaceSchema = z.enum(INVOICE_PDF_PLACES);
export type InvoicePdfPlace = z.infer<typeof InvoicePdfPlaceSchema>;

/** How long before a document's end the reminder goes out (a setting). */
export const DEFAULT_DOCUMENT_REMINDER_DAYS = 30;
export const DOCUMENT_REMINDER_MAX_DAYS = 120;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** A contest's reason, or the reason of its end: the contractor's or the owner's words, 1 to 500 characters. */
export const InvoiceReasonSchema = trimmed(INVOICE_REASON_MAX);

/** One text a regime prints on each invoice, in its order: the regime's own words, never the code's. */
export const InvoiceMentionSchema = trimmed(INVOICE_MENTION_MAX);

/**
 * What an invoice prints after its due date, the agency's words validated by its accountant, never the code's: no
 * discount for an early payment, the late-payment penalty rate the contract sets (three times the legal interest rate
 * at the least), the 40 € indemnity (art. L441-9, L441-10 and D441-5 of the Code de commerce).
 */
export const PaymentTermsSchema = trimmed(PAYMENT_TERMS_MAX);

/** The designation of the service each invoice prints above its lines (`SERVICE_DESCRIPTION_MAX`). */
export const ServiceDescriptionSchema = trimmed(SERVICE_DESCRIPTION_MAX);

/** A French company's SIREN (nine digits) or the SIRET of one of its establishments (fourteen). */
export const BUSINESS_ID_PATTERN = '^([0-9]{9}|[0-9]{14})$';
export const BusinessIdSchema = z
  .string()
  .regex(new RegExp(BUSINESS_ID_PATTERN, 'u'), 'Un SIREN (9 chiffres) ou un SIRET (14 chiffres)');

/** An intra-community VAT number: the country's two letters, then two to thirteen digits or capitals. */
export const VAT_NUMBER_PATTERN = '^[A-Z]{2}[0-9A-Z]{2,13}$';
export const VatNumberSchema = z
  .string()
  .regex(new RegExp(VAT_NUMBER_PATTERN, 'u'), 'Un numéro de TVA intracommunautaire');

/**
 * Whether a SIREN's last digit is its check key (Luhn, as INSEE computes it). Only some SIRETs of La Poste escape the
 * rule, never a SIREN.
 */
export function sirenChecksOut(siren: string): boolean {
  if (!/^[0-9]{9}$/u.test(siren)) return false;
  let sum = 0;
  for (let index = 0; index < siren.length; index += 1) {
    // From the right, every second digit counts twice, its two digits added.
    const digit = Number(siren[siren.length - 1 - index]);
    const counted = index % 2 === 1 ? digit * 2 : digit;
    sum += counted > 9 ? counted - 9 : counted;
  }
  return sum % 10 === 0;
}

/**
 * The intra-community VAT number of a French company, from its SIREN: `FR`, a two-digit key, then the SIREN; the key is
 * (12 + 3 × (SIREN mod 97)) mod 97.
 */
export function frenchVatNumberOf(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${siren}`;
}

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

/**
 * A contractor's file: who his invoices are in the name of. He fills it himself, the owner checks it; any change of
 * identity asks for a new check. The country is his member record's (EQ-01). The prefix is frozen at his first invoice.
 */
export const ContractorProfileSchema = z.object({
  memberId: TeamMemberIdSchema,
  legalName: trimmed(LEGAL_NAME_MAX),
  address: trimmed(POSTAL_ADDRESS_MAX),
  taxId: trimmed(TAX_ID_MAX).nullable(),
  /** Established in France: his SIREN or SIRET, which his invoices print and require. */
  businessId: BusinessIdSchema.nullable(),
  /** Charging VAT: his intra-community VAT number, which his invoices print and require. */
  vatNumber: VatNumberSchema.nullable(),
  /** An individual entrepreneur: his invoices print « EI » after his name. */
  individualEntrepreneur: z.boolean(),
  /**
   * A company established in France: its legal form, share capital and trade-register town, which its invoices print
   * and require (art. R123-237 of the Code de commerce, the accountant's answers of 01/11); `null` for a person.
   */
  legalForm: trimmed(AGENCY_LEGAL_FORM_MAX).nullable(),
  shareCapitalMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  rcsCity: trimmed(RCS_CITY_MAX).nullable(),
  email: z.email().max(BILLING_EMAIL_MAX),
  invoicePrefix: InvoicePrefixSchema.nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ContractorProfile = z.infer<typeof ContractorProfileSchema>;

/** The owner's check of a document (lot 5c): accepted, or refused with its reason. */
export const CONTRACTOR_DOCUMENT_DECISIONS = ['accepted', 'refused'] as const;
export const ContractorDocumentDecisionSchema = z.enum(CONTRACTOR_DOCUMENT_DECISIONS);
export type ContractorDocumentDecision = z.infer<typeof ContractorDocumentDecisionSchema>;
export const DOCUMENT_REFUSAL_REASON_MAX = 500;

/**
 * `POST /v1/payroll/contractors/:memberId/documents/:documentId/review` (lot 5c, « ok vérif pièce »), the owner only and
 * never on his own file: the document accepted, or refused with its reason, which the contractor reads. Once: the same
 * decision sent again gives the document back; another, `contractor_document_reviewed_conflict`. A refused document
 * counts as none; the contractor files a new one. Accepting puts its file under the compliance lock of the invoices it
 * covers, and a tax residence certificate accepted lets his waiting statements be invoiced.
 */
export const ContractorDocumentReviewSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accepted') }),
  z.object({ decision: z.literal('refused'), reason: trimmed(DOCUMENT_REFUSAL_REASON_MAX) }),
]);
export type ContractorDocumentReview = z.infer<typeof ContractorDocumentReviewSchema>;

/** The check as the file shows it: the decision, its reason for a refusal, and when the owner made it. */
export const ContractorDocumentReviewedSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accepted'), reviewedAt: z.iso.datetime() }),
  z.object({
    decision: z.literal('refused'),
    reason: trimmed(DOCUMENT_REFUSAL_REASON_MAX),
    reviewedAt: z.iso.datetime(),
  }),
]);
export type ContractorDocumentReviewed = z.infer<typeof ContractorDocumentReviewedSchema>;

/**
 * What a document's file may be (lot 5c): a PDF, or the photo of the paper (JPEG, PNG). The server reads it from the
 * file's first bytes, never from what the client says.
 */
export const CONTRACTOR_DOCUMENT_MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const ContractorDocumentMediaTypeSchema = z.enum(CONTRACTOR_DOCUMENT_MEDIA_TYPES);
export type ContractorDocumentMediaType = z.infer<typeof ContractorDocumentMediaTypeSchema>;

/** A document's file weighs 10 MB at most: a phone's photo of a page weighs less. */
export const CONTRACTOR_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Why a file is refused (`contractor_document_invalid`): too heavy, or neither a PDF nor a JPEG nor a PNG. */
export const CONTRACTOR_DOCUMENT_REFUSALS = ['too_heavy', 'not_supported'] as const;
export const ContractorDocumentRefusalSchema = z.enum(CONTRACTOR_DOCUMENT_REFUSALS);
export type ContractorDocumentRefusal = z.infer<typeof ContractorDocumentRefusalSchema>;

/** A document of the regime, dated; the old one stays kept with the invoices it covered. */
export const ContractorDocumentSchema = z.object({
  id: ContractorDocumentIdSchema,
  memberId: TeamMemberIdSchema,
  kind: ContractorDocumentKindSchema,
  issuedOn: CalendarDaySchema,
  /** The end the document states, `null` when it states none. */
  validUntil: CalendarDaySchema.nullable(),
  /**
   * Its last day: the one it states; otherwise the 31st of December of its year for a tax residence certificate, six
   * months from its issue, the day before, for a vigilance certificate.
   */
  lastDay: CalendarDaySchema,
  mediaType: ContractorDocumentMediaTypeSchema,
  sha256: Sha256Schema,
  /** The owner's check, `null` while it waits. */
  review: ContractorDocumentReviewedSchema.nullable(),
  /** When the file of a refused document was erased (« ok purge a »), `null` while the bucket holds it. */
  purgedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ContractorDocument = z.infer<typeof ContractorDocumentSchema>;

/**
 * A version of the service contract or of the mandate: the agency's text, validated by its accountant, never written
 * by a session. Its SHA-256 is computed by the base. The mandate fixes the delay to contest.
 */
export const ContractTextSchema = z.object({
  id: ContractTextIdSchema,
  kind: ContractTextKindSchema,
  version: z.number().int().min(1),
  body: z.string().min(1).max(CONTRACT_TEXT_MAX),
  sha256: Sha256Schema,
  contestDelayDays: z.number().int().min(1).max(CONTEST_DELAY_MAX_DAYS).nullable(),
  createdAt: z.iso.datetime(),
});
export type ContractText = z.infer<typeof ContractTextSchema>;

/** The contractor accepted this version of this text, at this instant: the text's SHA-256 is kept as proof. */
export const ContractAcceptanceSchema = z.object({
  id: ContractAcceptanceIdSchema,
  memberId: TeamMemberIdSchema,
  textId: ContractTextIdSchema,
  sha256: Sha256Schema,
  acceptedAt: z.iso.datetime(),
});
export type ContractAcceptance = z.infer<typeof ContractAcceptanceSchema>;

/** An accounting account as the accountant gives it, never written in the code. */
export const AccountCodeSchema = z.string().regex(/^[0-9A-Z]{1,20}$/u, 'Un compte : chiffres et majuscules');

/** The accounts of the purchase journal; the supplier account is followed by the contractor's prefix. */
export const JournalAccountsSchema = z.object({
  expense: AccountCodeSchema,
  supplierPrefix: AccountCodeSchema,
  vatDeductible: AccountCodeSchema,
  vatSelfAssessed: AccountCodeSchema,
});
export type JournalAccounts = z.infer<typeof JournalAccountsSchema>;

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
  /** The purchase journal's accounts, `null` until the accountant gives them: the export never leaves without. */
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
 * for none; the accounts and the reminder delay are set elsewhere and kept.
 */
export const UpdateBillingSettingsBodySchema = z.object({
  agency: BillingAgencyBodySchema,
  serviceDescription: ServiceDescriptionSchema,
  paymentTerms: PaymentTermsSchema,
  dueDays: z.number().int().min(INVOICE_DUE_MIN_DAYS).max(INVOICE_DUE_MAX_DAYS),
  fiscalYearEndMonth: z.number().int().min(1).max(12),
  logoSha256: Sha256Schema.nullable(),
});
export type UpdateBillingSettingsBody = z.infer<typeof UpdateBillingSettingsBodySchema>;

/** The regime as an invoice copies it at its issue. */
export const InvoiceRegimeSchema = BillingRegimeSchema.omit({ createdAt: true, countries: true });
export type InvoiceRegime = z.infer<typeof InvoiceRegimeSchema>;

/** A line as the invoice prints it, excluding VAT, negative for a deduction; a credit note's lines are negative. */
export const InvoiceLineSchema = z.object({
  kind: InvoiceLineKindSchema,
  label: trimmed(INVOICE_LINE_LABEL_MAX),
  detail: trimmed(INVOICE_LINE_DETAIL_MAX).nullable(),
  amountMinor: z.number().int(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

/** An invoice's totals, rounded once on the total; a credit note's are negative. */
export const InvoiceTotalsSchema = z.object({
  exclVatMinor: z.number().int(),
  vatMinor: z.number().int(),
  inclVatMinor: z.number().int(),
  /** Under reverse charge, the VAT the agency both owes and deducts; nothing is invoiced. */
  selfAssessedVatMinor: z.number().int(),
});
export type InvoiceTotals = z.infer<typeof InvoiceTotalsSchema>;

/**
 * Where a document stands with its contractor: its state, the end of the delay to answer (the issue plus the mandate's
 * delay, to the second), and the reason of its contest once contested (kept after the contest ends).
 */
export const InvoiceAcceptanceSchema = z.object({
  state: InvoiceAcceptanceStateSchema,
  deadline: z.iso.datetime(),
  reason: InvoiceReasonSchema.nullable(),
});
export type InvoiceAcceptance = z.infer<typeof InvoiceAcceptanceSchema>;

/**
 * An invoice or a credit note as its reader reads it, frozen at its issue. An invoice belongs to the validated
 * statement it bills, one per statement; a credit note cites the invoice it credits, and the statement that made it
 * due when a period owed it (ADR 0036).
 */
export const InvoiceSchema = z
  .object({
    id: InvoiceIdSchema,
    kind: InvoiceKindSchema,
    memberId: TeamMemberIdSchema,
    statementId: CommissionStatementIdSchema.nullable(),
    creditedInvoiceId: InvoiceIdSchema.nullable(),
    period: PayPeriodSchema,
    number: InvoiceNumberSchema,
    issuedAt: z.iso.datetime(),
    issuedOn: CalendarDaySchema,
    dueOn: CalendarDaySchema,
    contractor: InvoiceContractorSchema,
    agency: InvoiceAgencySchema,
    regime: InvoiceRegimeSchema,
    mentions: z.array(InvoiceMentionSchema).max(INVOICE_DOCUMENT_MENTIONS_MAX),
    /** An invoice's designation of the service, copied at the issue; `null` on a credit note. */
    serviceDescription: ServiceDescriptionSchema.nullable(),
    /** The agency's logo at the issue, by its fingerprint; `null` for none. */
    logoSha256: Sha256Schema.nullable(),
    lines: z.array(InvoiceLineSchema).min(1),
    totals: InvoiceTotalsSchema,
    acceptance: InvoiceAcceptanceSchema,
    pdfSha256: Sha256Schema.nullable(),
  })
  .refine(
    (invoice) =>
      invoice.kind === 'invoice'
        ? invoice.statementId !== null &&
          invoice.creditedInvoiceId === null &&
          invoice.totals.exclVatMinor > 0
        : invoice.creditedInvoiceId !== null && invoice.totals.exclVatMinor < 0,
    'Une facture a son relevé et un total positif ; un avoir cite sa facture, avec un total négatif',
  );
export type Invoice = z.infer<typeof InvoiceSchema>;

/** A dated step of an invoice: who made it (`null` for a job), its reason, and the statement that paid it. */
export const InvoiceEventSchema = z.object({
  id: InvoiceEventIdSchema,
  invoiceId: InvoiceIdSchema,
  kind: InvoiceEventKindSchema,
  reason: InvoiceReasonSchema.nullable(),
  statementId: CommissionStatementIdSchema.nullable(),
  by: UserIdSchema.nullable(),
  at: z.iso.datetime(),
});
export type InvoiceEvent = z.infer<typeof InvoiceEventSchema>;

/**
 * An invoice or a credit note in a path, for whoever reads it (the contractor, the owner, an active manager):
 *
 * - `GET /v1/payroll/invoices/:invoiceId/pdf` (EQ-06 lot 4, ADR 0037 § 7): its PDF, as `application/pdf` named after
 *   its number. Only ever a file whose SHA-256 is the one recorded at its render; `invoice_pdf_not_found` while it is
 *   being rendered, `invoice_pdf_unavailable` when neither bucket gives it intact.
 * - `GET /v1/payroll/invoices/:invoiceId/acceptance` (lot 6) → `InvoiceAcceptanceViewSchema`.
 * - `POST /v1/payroll/invoices/:invoiceId/accept` (lot 6, the contractor alone, ADR 0039 § 1) → the view, 200; the
 *   same answer sent again gives the view back.
 * - `POST /v1/payroll/invoices/:invoiceId/contest` (the contractor alone), body `ContestInvoiceBodySchema` → the view;
 *   the same reason sent again gives it back. The owner is told (`invoice_contested`).
 * - `POST /v1/payroll/invoices/:invoiceId/contest/refuse` (the owner alone, ADR 0039 § 3), body
 *   `RefuseInvoiceContestBodySchema` → the view; the same reason sent again gives it back.
 * - `POST /v1/payroll/invoices/:invoiceId/contest/uphold` (the owner alone, ADR 0039 § 3 to 5), body
 *   `UpholdInvoiceContestBodySchema` → the view; the contest ends upheld and its correction is written in the same
 *   transaction, as adjustments of the member's first open period that correct the document's period. The same
 *   reason and correction sent again give the view back.
 *
 * `invoice_not_found` (unknown, or not the reader's), `invoice_answer_forbidden` (another's document to answer),
 * `payroll_forbidden` (an end of a contest by anyone but the owner), `invoice_acceptance_conflict` (a step its state
 * or its delay no longer allows, or another answer than the one recorded), `credit_note_amount_unprocessable` (a
 * correction in the agency's favour above what the invoice has left), `invoice_correction_unprocessable` (a cancel
 * and reissue of a credit note, or of an invoice its credit notes took off whole).
 */
export const InvoiceParamsSchema = z.object({ invoiceId: InvoiceIdSchema });

/** « Je conteste » : the contractor's reason. */
export const ContestInvoiceBodySchema = z.object({ reason: InvoiceReasonSchema });
export type ContestInvoiceBody = z.infer<typeof ContestInvoiceBodySchema>;

/** The owner refuses a contest, with the reason the contractor reads. */
export const RefuseInvoiceContestBodySchema = z.object({ reason: InvoiceReasonSchema });
export type RefuseInvoiceContestBody = z.infer<typeof RefuseInvoiceContestBodySchema>;

/**
 * What corrects a contest the owner upholds (ADR 0039 § 3), always through pay, never a credit note written by hand:
 *
 * - `amount`: one adjustment, excluding VAT. In the contractor's favour (a sum too low), a line of their next invoice
 *   with the period it corrects; in the agency's (a sum too high), a credit note on the document's invoice at the next
 *   validation (ADR 0036).
 * - `reissue` (« Annuler et refacturer »), an error of text on an invoice (a name, an address, an identifier, a
 *   mention): two adjustments of what is left of it, in the same period. The negative one cancels it by a credit note,
 *   the positive one is a line of that period's invoice, which prints the corrected file; the payouts do not move, and
 *   the credit note never leaves without that invoice.
 */
export const ContestCorrectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('amount'),
    amountMinor: z
      .number()
      .int()
      .min(-PAY_AMOUNT_MAX_MINOR)
      .max(PAY_AMOUNT_MAX_MINOR)
      .refine((amount) => amount !== 0, 'Un montant de 0 ne corrige rien'),
  }),
  z.object({ kind: z.literal('reissue') }),
]);
export type ContestCorrection = z.infer<typeof ContestCorrectionSchema>;

/** The owner upholds a contest: the reason the contractor reads, and its correction in the same action. */
export const UpholdInvoiceContestBodySchema = z.object({
  reason: InvoiceReasonSchema,
  correction: ContestCorrectionSchema,
});
export type UpholdInvoiceContestBody = z.infer<typeof UpholdInvoiceContestBodySchema>;

/** A document's acceptance as its reader reads it: its state and each dated step, in order (`issued` first). */
export const InvoiceAcceptanceViewSchema = z.object({
  invoiceId: InvoiceIdSchema,
  kind: InvoiceKindSchema,
  memberId: TeamMemberIdSchema,
  number: InvoiceNumberSchema,
  acceptance: InvoiceAcceptanceSchema,
  events: z.array(InvoiceEventSchema).min(1),
});
export type InvoiceAcceptanceView = z.infer<typeof InvoiceAcceptanceViewSchema>;

/**
 * The contractor's file and texts (EQ-06 lot 5a). `memberId` names the contractor; the owner, an active manager and
 * the contractor himself read his file, anyone else gets `team_member_not_found`.
 */
export const ContractorParamsSchema = z.object({ memberId: TeamMemberIdSchema });

/**
 * `PUT /v1/payroll/contractors/:memberId/profile`, the contractor himself or the owner: who his invoices are in the name
 * of. The same values sent again change nothing; any change of identity clears the owner's check (the base's trigger),
 * and the statements whose invoice waits for it are tried again (`payroll.requeue_invoice_issues`). The country is his
 * member record's; the prefix and the check are the owner's (their own routes). A typo in a SIREN or in a French VAT
 * number would be printed on every invoice: both are checked before they are saved.
 */
export const ContractorProfileBodySchema = ContractorProfileSchema.pick({
  legalName: true,
  address: true,
  taxId: true,
  businessId: true,
  vatNumber: true,
  individualEntrepreneur: true,
  legalForm: true,
  shareCapitalMinor: true,
  rcsCity: true,
  email: true,
}).superRefine((profile, context) => {
  const company = [profile.legalForm, profile.shareCapitalMinor, profile.rcsCity];
  if (company.some((value) => value === null) && company.some((value) => value !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['legalForm'],
      message: 'Une société donne sa forme, son capital et la ville de son RCS, les trois ensemble.',
    });
  }
  if (profile.individualEntrepreneur && profile.legalForm !== null) {
    context.addIssue({
      code: 'custom',
      path: ['legalForm'],
      message: 'Un entrepreneur individuel n’a ni forme de société, ni capital, ni RCS.',
    });
  }
  if (profile.businessId === null) return;
  const siren = profile.businessId.slice(0, 9);
  if (!sirenChecksOut(siren)) {
    context.addIssue({
      code: 'custom',
      path: ['businessId'],
      message: 'Ce numéro n’est pas un SIREN : sa clé de contrôle (le 9e chiffre) ne correspond pas.',
    });
    return;
  }
  const expected = frenchVatNumberOf(siren);
  if (profile.vatNumber?.startsWith('FR') === true && profile.vatNumber !== expected) {
    context.addIssue({
      code: 'custom',
      path: ['vatNumber'],
      message: `Le numéro de TVA intracommunautaire de ce SIREN est ${expected}.`,
    });
  }
});
export type ContractorProfileBody = z.infer<typeof ContractorProfileBodySchema>;

/**
 * `POST /v1/payroll/contractors/:memberId/profile/verify`, the owner only: he checked the file as he read it, at its
 * `updatedAt`. A file changed since is `contractor_profile_changed_conflict`, never checked unseen; a file checked
 * already is given back as it is.
 */
export const VerifyContractorProfileBodySchema = z.object({ updatedAt: z.iso.datetime() });
export type VerifyContractorProfileBody = z.infer<typeof VerifyContractorProfileBodySchema>;

/**
 * `PUT /v1/payroll/contractors/:memberId/profile/prefix`, the owner only: the contractor's own prefix, which no one else
 * holds (`invoice_prefix_taken_conflict`), frozen by his first invoice (`invoice_prefix_frozen_conflict`).
 */
export const InvoicePrefixBodySchema = z.object({ invoicePrefix: InvoicePrefixSchema });
export type InvoicePrefixBody = z.infer<typeof InvoicePrefixBodySchema>;

/**
 * `GET /v1/payroll/contractors/:memberId/file`: his file (`null` until it is first written), his country, whether his
 * first invoice froze his prefix, the texts he accepted, the newest version of each kind first, his regimes, and his
 * documents with the owner's check of each.
 */
export const ContractorFileSchema = z.object({
  memberId: TeamMemberIdSchema,
  country: CountryCodeSchema,
  profile: ContractorProfileSchema.nullable(),
  prefixFrozen: z.boolean(),
  acceptances: z.array(ContractAcceptanceSchema),
  /** His regimes, each from its day, the latest first (lot 5b): the one in force is the latest begun. */
  regimes: z.array(ContractorRegimeSchema),
  /** His documents, the latest filed first (lot 5c): a renewal never takes the place of the old one. */
  documents: z.array(ContractorDocumentSchema),
});
export type ContractorFile = z.infer<typeof ContractorFileSchema>;

/** A text as the owner pastes it, never trimmed nor rewritten: its SHA-256 is the proof of what is accepted. */
const ContractTextBodySchema = z
  .string()
  .min(1)
  .max(CONTRACT_TEXT_MAX)
  .refine((body) => body.trim() !== '', 'Un texte vide ne s’accepte pas');

/**
 * `POST /v1/payroll/contract-texts`, the owner only: a new version of the service contract or of the mandate, the
 * agency's text as its accountant validated it. The server numbers it (the next of its kind) and computes its SHA-256;
 * the same `id` sent again with the same text gives it back, with another text is `contract_text_id_conflict`. The
 * mandate fixes the delay to contest, in whole days.
 */
export const CreateContractTextBodySchema = z.discriminatedUnion('kind', [
  z.object({ id: ContractTextIdSchema, kind: z.literal('service_contract'), body: ContractTextBodySchema }),
  z.object({
    id: ContractTextIdSchema,
    kind: z.literal('billing_mandate'),
    body: ContractTextBodySchema,
    contestDelayDays: z.number().int().min(1).max(CONTEST_DELAY_MAX_DAYS),
  }),
]);
export type CreateContractTextBody = z.infer<typeof CreateContractTextBodySchema>;

/** `GET /v1/payroll/contract-texts`, any member: every version of each kind, the newest first. */
export const ContractTextsSchema = z.object({ texts: z.array(ContractTextSchema) });
export type ContractTexts = z.infer<typeof ContractTextsSchema>;

export const ContractTextParamsSchema = z.object({ textId: ContractTextIdSchema });

/**
 * `POST /v1/payroll/contract-texts/:textId/accept`, the contractor himself (`contract_acceptance_forbidden` for anyone
 * else, the owner included): he accepts the version he read, whose SHA-256 his screen sends. Another text than the one
 * read is `contract_text_changed_conflict`; a version a newer one replaced, `contract_text_superseded_conflict`. An
 * acceptance sent again gives back the first. A mandate accepted tries again the statements that waited for it.
 */
export const AcceptContractTextBodySchema = z.object({ sha256: Sha256Schema });
export type AcceptContractTextBody = z.infer<typeof AcceptContractTextBodySchema>;

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

/**
 * `POST /v1/payroll/contractors/:memberId/documents?id=…&kind=…&issuedOn=…[&validUntil=…]` (lot 5c), by the
 * contractor himself or the owner, never a manager: the file is the body, its bytes as they are
 * (`content-type: application/octet-stream`), a PDF, a JPEG or a PNG of 10 MB at most (`contractor_document_invalid`
 * otherwise, its reason in `details.reason`). Its date of issue is never ahead of today in the agency's zone
 * (`contractor_document_issued_future_unprocessable`). A tax residence certificate states no end: it holds for the
 * calendar year of its issue. The same `id` sent again with the same file and dates gives it back; with others,
 * `contractor_document_id_conflict`. A tax residence certificate filed tries his waiting statements again: the owner
 * is told it waits for his check.
 */
export const UploadContractorDocumentQuerySchema = z
  .object({
    id: ContractorDocumentIdSchema,
    kind: ContractorDocumentKindSchema,
    issuedOn: CalendarDaySchema,
    validUntil: CalendarDaySchema.optional(),
  })
  .refine((query) => query.kind !== 'tax_residence' || query.validUntil === undefined, {
    message:
      'L’attestation de résidence fiscale vaut pour l’année civile de sa délivrance : pas de fin à saisir',
    path: ['validUntil'],
  })
  .refine((query) => query.validUntil === undefined || query.validUntil > query.issuedOn, {
    message: 'La fin de validité suit la date de délivrance',
    path: ['validUntil'],
  });
export type UploadContractorDocumentQuery = z.infer<typeof UploadContractorDocumentQuerySchema>;

export const ContractorDocumentParamsSchema = z.object({
  memberId: TeamMemberIdSchema,
  documentId: ContractorDocumentIdSchema,
});

/**
 * The refusals of the invoices' rules (EQ-06), each suffix setting its status (api.md). Kept apart from
 * `PAYROLL_ERROR_CODES` until the invoices' screens word them (lot 8).
 */
export const INVOICE_ERROR_CODES = [
  /** A logo the server refuses to keep, with its reason in `details.reason` (`AGENCY_LOGO_REFUSALS`). */
  'agency_logo_invalid',
  /** No logo was added with this fingerprint. */
  'agency_logo_not_found',
  'billing_regime_backdated_unprocessable',
  /** The regime is not one of the contractor's country: its mentions and its VAT are another country's. */
  'billing_regime_country_unprocessable',
  /** The same id sent again with another regime. */
  'billing_regime_id_conflict',
  'billing_regime_not_found',
  /** The accountant's validation is recorded already, on another day: it is recorded once. */
  'billing_regime_validated_conflict',
  /** A validation recorded for a day still to come. */
  'billing_regime_validation_future_unprocessable',
  /** The same id sent again with another contractor, regime or day. */
  'contractor_regime_id_conflict',
  /** The same id sent again with another file or other dates. */
  'contractor_document_id_conflict',
  /** A file the server refuses to keep, with its reason in `details.reason` (`CONTRACTOR_DOCUMENT_REFUSALS`). */
  'contractor_document_invalid',
  /** A date of issue still to come. */
  'contractor_document_issued_future_unprocessable',
  'contractor_document_not_found',
  /** The owner checked it already, otherwise: a document is checked once. */
  'contractor_document_reviewed_conflict',
  /** The bucket did not give the file with its fingerprint: never an altered file. */
  'contractor_document_unavailable',
  /**
   * The file of a refused document, erased once its upload lock ended (« ok purge a » de Charles, 01/11): its row, its
   * reason and its fingerprint stay.
   */
  'contractor_document_file_gone',
  'credit_note_amount_unprocessable',
  'invoice_acceptance_conflict',
  /** Only the contractor answers their document: never the owner, a manager or another member (ADR 0039 § 1). */
  'invoice_answer_forbidden',
  /**
   * A correction the document does not allow (ADR 0039 § 3), its reason in `details.reason`: `reissue_credit_note`
   * (only an invoice is cancelled and reissued), `nothing_left` (its credit notes took it off whole already),
   * `above_pay_amount_max` (what it has left is more than one adjustment of pay carries, `PAY_AMOUNT_MAX_MINOR`).
   */
  'invoice_correction_unprocessable',
  /** The invoice does not exist, or is not the reader's. */
  'invoice_not_found',
  /** Its PDF is not rendered yet (« PDF en préparation », ADR 0037 § 5). */
  'invoice_pdf_not_found',
  /** Neither bucket gave the PDF with its fingerprint: never an altered file (ADR 0037 § 7). */
  'invoice_pdf_unavailable',
  /** Only the contractor accepts his contract and his mandate, never the owner nor a manager for him. */
  'contract_acceptance_forbidden',
  /** The text the screen showed is not this version's: the contractor accepts only what he read. */
  'contract_text_changed_conflict',
  /** The same id sent again with another text. */
  'contract_text_id_conflict',
  'contract_text_not_found',
  /** A newer version of this kind replaced it: the contractor reads and accepts that one. */
  'contract_text_superseded_conflict',
  /** The file changed since the owner read it: he checks again what he sees. */
  'contractor_profile_changed_conflict',
  /** A manager, or another member, writing a contractor's file: only the contractor and the owner write it. */
  'contractor_profile_forbidden',
  /** The contractor has not written his file yet. */
  'contractor_profile_not_found',
  /** The contractor's first invoice froze his prefix. */
  'invoice_prefix_frozen_conflict',
  /** Another contractor holds this prefix. */
  'invoice_prefix_taken_conflict',
] as const;
export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];
