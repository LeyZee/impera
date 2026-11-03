import { z } from 'zod';

import {
  BillingRegimeIdSchema,
  CommissionStatementIdSchema,
  ContractAcceptanceIdSchema,
  ContractTextIdSchema,
  ContractorDocumentIdSchema,
  ContractorRegimeIdSchema,
  InvoiceEventIdSchema,
  InvoiceIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from './ids';
import { dayNumber, trimmed } from './invoices-internal';
import { PAY_AMOUNT_MAX_MINOR } from './money';
import { PayPeriodSchema } from './pay-periods';
import { BasisPointsSchema, CountryCodeSchema } from './team';
import { CalendarDaySchema, TeamMemberSchema } from './team-members';

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
export type Withholding = z.infer<typeof WithholdingSchema>;

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

/**
 * A step of an invoice's life, each dated in `invoice_events`, added only. The last three settle a document in full,
 * once, and name the statement that settles it (EQ-06 lot 7a): `paid`, an invoice by that statement's transfer;
 * `imputed`, a credit note deducted from it; `compensated`, a document whose debt ends with no transfer, at a statement
 * whose cumulated total is zero, or below zero for an invoice (ADR 0038, art. 1347 du Code civil).
 */
export const INVOICE_EVENT_KINDS = [
  'issued',
  'accepted',
  'contested',
  'lapsed',
  'contest_upheld',
  'contest_refused',
  'paid',
  'imputed',
  'compensated',
] as const;
export const InvoiceEventKindSchema = z.enum(INVOICE_EVENT_KINDS);
export type InvoiceEventKind = z.infer<typeof InvoiceEventKindSchema>;

/**
 * Why a document a validated statement makes due is not issued (EQ-06): its invoice, for want of an accepted mandate,
 * of a regime the accountant validated and written for the contractor's country, of a full identity the owner checked,
 * of a prefix or of the agency's identity; a credit note the period owes, when no invoice can take it whole (ADR 0036).
 * The statement stays validated and the owner is told (`invoice_not_issued`).
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
   * No tax residence certificate of the period's year under a tax treaty (lot 5c). Since ADR 0041 the certificate gates
   * the transfer (`payout_blocked_conflict`), not the invoice: no issue gives this reason any more, kept to read what
   * was written before.
   */
  'tax_residence_missing',
  /** A certificate of the period's year waiting for the owner's check (lot 5c); kept as `tax_residence_missing` is. */
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

/** A dated step of an invoice: who made it (`null` for a job), its reason, and the statement that settled it (`paid`, `imputed`, `compensated`). */
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

/** How a document's debt ended (EQ-06 lot 7a): the last three steps of `INVOICE_EVENT_KINDS`. */
export const INVOICE_SETTLEMENT_KINDS = ['paid', 'imputed', 'compensated'] as const;
export const InvoiceSettlementKindSchema = z.enum(INVOICE_SETTLEMENT_KINDS);
export type InvoiceSettlementKind = z.infer<typeof InvoiceSettlementKindSchema>;

/**
 * A document's settlement as a list reads it: how its debt ended, the statement that ended it, and the day, the
 * statement's transfer for `paid` and `imputed` (the day the owner recorded the money as sent), the agency's calendar
 * day of the step for `compensated`, where nothing is sent.
 */
export const InvoiceSettlementSchema = z.object({
  kind: InvoiceSettlementKindSchema,
  statementId: CommissionStatementIdSchema,
  on: CalendarDaySchema,
});
export type InvoiceSettlement = z.infer<typeof InvoiceSettlementSchema>;

/**
 * Why the transfer of a validated statement cannot be recorded (ADR 0041). The documents it pays are not all issued
 * (`documents_not_issued`): the invoices less the credit notes of the statement and of those carried into it do not
 * come to what it pays yet, and paying without an invoice is ruled out. Or, under a tax treaty that sets the 182 B
 * withholding aside, the contractor's tax residence certificate of the transfer's calendar year is missing or refused
 * (`tax_residence_missing`), or filed and not checked by the owner yet (`tax_residence_unverified`). The agency never
 * withholds 25 %: it does not pay.
 */
export const PAYOUT_BLOCK_REASONS = [
  'documents_not_issued',
  'tax_residence_missing',
  'tax_residence_unverified',
] as const;
export const PayoutBlockReasonSchema = z.enum(PAYOUT_BLOCK_REASONS);
export type PayoutBlockReason = z.infer<typeof PayoutBlockReasonSchema>;

/**
 * A transfer that waits (ADR 0041 § 4): why, and for a certificate the calendar year it must cover (`null` for the
 * documents).
 */
export const PayoutBlockSchema = z
  .object({
    reason: PayoutBlockReasonSchema,
    year: z
      .string()
      .regex(/^\d{4}$/u)
      .nullable(),
  })
  .refine((block) => (block.year === null) === (block.reason === 'documents_not_issued'), {
    message: 'Une année pour une attestation, aucune pour les documents',
    path: ['year'],
  });
export type PayoutBlock = z.infer<typeof PayoutBlockSchema>;

/** An invoice not settled turns `soon` this many days before its due date, the day its alert goes (EQ-06 lot 8). */
export const INVOICE_DUE_SOON_DAYS = 7;

/**
 * Where a document stands with its due date (EQ-06 lot 8), computed by the server on the agency's calendar day, never
 * by a screen: `settled` once its debt ended (`InvoiceSettlementSchema`); else, for an invoice (a corrective one
 * included), `overdue` from the day after its due date, `soon` from `INVOICE_DUE_SOON_DAYS` days before it, `open`
 * before. A credit note is never `soon` nor `overdue`: it carries no payment terms, the contractor's debt is taken off
 * a payout (ADR 0036), so it stays `open` until then.
 */
export const INVOICE_DUE_STATES = ['open', 'soon', 'overdue', 'settled'] as const;
export const InvoiceDueStateSchema = z.enum(INVOICE_DUE_STATES);
export type InvoiceDueState = z.infer<typeof InvoiceDueStateSchema>;

/** Days of issue a list covers at most, both ends included (`from` and `to` of `InvoiceListQuerySchema`). */
export const INVOICE_LIST_MAX_DAYS = 366;

/** A comma-separated list of a query string (`due=soon,overdue`), each value once and known. */
const listOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((text) => text.split(','))
    .pipe(
      z
        .array(z.enum(values))
        .min(1)
        .refine((items) => new Set(items).size === items.length, { message: 'Une valeur une seule fois' }),
    );

/**
 * `GET /v1/payroll/invoices` (EQ-06 lot 8): the documents a reader reads (the policy of `invoices`: every one for the
 * owner and an active manager, one's own for anyone else), filtered. Every filter is optional and they add up, but a
 * list is always bounded without pages: the query gives a quinzaine (`period`, the documents of its statements), or a
 * range of days of issue (`from` and `to`, `INVOICE_LIST_MAX_DAYS` at most), or a filter that keeps only documents
 * still waiting, which are few by nature: `due` without `settled` (a document not settled is 60 days old at most,
 * unless its payout is blocked), or `acceptance` among `pending` and `contested` (an answer is due within the
 * mandate's delay). Anything else is a 400.
 */
export const InvoiceListQuerySchema = z
  .object({
    memberId: TeamMemberIdSchema.optional(),
    period: PayPeriodSchema.optional(),
    from: CalendarDaySchema.optional(),
    to: CalendarDaySchema.optional(),
    due: listOf(INVOICE_DUE_STATES).optional(),
    acceptance: listOf(INVOICE_ACCEPTANCE_STATES).optional(),
  })
  .refine((query) => (query.from === undefined) === (query.to === undefined), {
    message: 'Le début et la fin, ensemble',
    path: ['to'],
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: 'La fin suit le début',
    path: ['to'],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      dayNumber(query.to) - dayNumber(query.from) < INVOICE_LIST_MAX_DAYS,
    { message: 'Un an au plus', path: ['to'] },
  )
  .refine(
    (query) =>
      query.period !== undefined ||
      query.from !== undefined ||
      (query.due !== undefined && !query.due.includes('settled')) ||
      (query.acceptance?.every((state) => state === 'pending' || state === 'contested') ?? false),
    {
      message:
        'Une quinzaine, une période, ou un filtre sur les documents encore en attente : la liste reste bornée',
      path: ['period'],
    },
  );
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

/**
 * A document of the list: what its screens show without recomputing a rule. `corrective` marks the invoice that bills
 * again a cancelled one (ADR 0040); `creditedInvoiceId` the invoice a credit note cites; `statementId` the statement it
 * was issued for (`null` on a credit note no validation issued), and `statementPeriod` that statement's quinzaine, where
 * the document leads (`Voir le relevé`): for an invoice its own `period`, for a credit note or a corrective invoice the
 * later quinzaine that owed it, whereas `period` is the one it corrects and prints. `pdfReady` says its PDF is rendered,
 * to download.
 */
export const InvoiceListItemSchema = z.object({
  id: InvoiceIdSchema,
  kind: InvoiceKindSchema,
  corrective: z.boolean(),
  memberId: TeamMemberIdSchema,
  number: InvoiceNumberSchema,
  period: PayPeriodSchema,
  statementId: CommissionStatementIdSchema.nullable(),
  statementPeriod: PayPeriodSchema.nullable(),
  creditedInvoiceId: InvoiceIdSchema.nullable(),
  issuedOn: CalendarDaySchema,
  dueOn: CalendarDaySchema,
  exclVatMinor: z.number().int(),
  vatMinor: z.number().int(),
  inclVatMinor: z.number().int(),
  acceptance: InvoiceAcceptanceSchema,
  settlement: InvoiceSettlementSchema.nullable(),
  due: InvoiceDueStateSchema,
  pdfReady: z.boolean(),
});
export type InvoiceListItem = z.infer<typeof InvoiceListItemSchema>;

/** The list, the latest issued first (day of issue, then number), and the agency's day its `due` was computed on. */
export const InvoiceListSchema = z.object({
  today: CalendarDaySchema,
  documents: z.array(InvoiceListItemSchema),
});
export type InvoiceList = z.infer<typeof InvoiceListSchema>;

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
/**
 * A document as the contractor's file shows it (lot 8), with `remindFrom`: the first day its renewal is reminded to the
 * contractor and the owner (`payroll.remind_documents` says it from that day), the 1st of December of its year for a
 * tax residence certificate, `documentReminderDays` before its last day for another. Only on a document a reminder
 * follows: for each kind the regime in force today asks for, the newest the owner has not refused. `null` on any other
 * (refused, replaced by a newer one, a kind the regime does not ask for, no regime, a member who left), so that the
 * screen never chooses which one counts.
 */
export const ContractorFileDocumentSchema = ContractorDocumentSchema.extend({
  remindFrom: CalendarDaySchema.nullable(),
});
export type ContractorFileDocument = z.infer<typeof ContractorFileDocumentSchema>;

export const ContractorFileSchema = z.object({
  memberId: TeamMemberIdSchema,
  /** The agency's calendar day the file was read on: `remindFrom` is compared with it, never with the device's clock. */
  today: CalendarDaySchema,
  country: CountryCodeSchema,
  profile: ContractorProfileSchema.nullable(),
  prefixFrozen: z.boolean(),
  acceptances: z.array(ContractAcceptanceSchema),
  /** His regimes, each from its day, the latest first (lot 5b): the one in force is the latest begun. */
  regimes: z.array(ContractorRegimeSchema),
  /** His documents, the latest filed first (lot 5c): a renewal never takes the place of the old one. */
  documents: z.array(ContractorFileDocumentSchema),
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

/** The documents waiting for the owner's check that `GET /v1/payroll/contractors/documents` gives at most. */
export const CONTRACTOR_DOCUMENTS_PENDING_MAX = 200;

/**
 * `GET /v1/payroll/contractors/documents?review=pending` (EQ-06 lot 8), the owner only, who alone checks a document:
 * every member's documents without a check yet, the oldest filed first, so that Aujourd'hui never reads each file one
 * by one; never his own, which he may not check. `review` names what the list holds; only the documents waiting exist today.
 */
export const ContractorDocumentsQuerySchema = z.object({ review: z.literal('pending') });
export type ContractorDocumentsQuery = z.infer<typeof ContractorDocumentsQuerySchema>;

/** A document waiting for the check, with its member's name as the team shows it; never its file. */
export const PendingContractorDocumentSchema = ContractorDocumentSchema.extend({
  displayName: TeamMemberSchema.shape.displayName,
});
export type PendingContractorDocument = z.infer<typeof PendingContractorDocumentSchema>;

/**
 * The documents waiting, `CONTRACTOR_DOCUMENTS_PENDING_MAX` at most, the oldest first; `more` says others wait after
 * them, which a check of the first ones brings into the list.
 */
export const PendingContractorDocumentsSchema = z.object({
  documents: z.array(PendingContractorDocumentSchema).max(CONTRACTOR_DOCUMENTS_PENDING_MAX),
  more: z.boolean(),
});
export type PendingContractorDocuments = z.infer<typeof PendingContractorDocumentsSchema>;

/**
 * The refusals of the invoices' rules (EQ-06), each suffix setting its status (api.md). Kept apart from
 * `PAYROLL_ERROR_CODES` until the invoices' screens word them (lot 8).
 */
export const INVOICE_ERROR_CODES = [
  /** A logo the server refuses to keep, with its reason in `details.reason` (`AGENCY_LOGO_REFUSALS`). */
  'agency_logo_invalid',
  /** No logo was added with this fingerprint. */
  'agency_logo_not_found',
  /** Réglages › Facturation is not saved yet: the accounts come after it. */
  'billing_settings_missing_conflict',
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
  /** The export needs every account and journal: those missing in `details.missing` (`JOURNAL_ACCOUNT_NAMES`). */
  'journal_accounts_missing_unprocessable',
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
