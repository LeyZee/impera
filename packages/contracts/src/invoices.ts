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
  'credited',
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
  'credited',
  'contest_refused',
  'paid',
] as const;
export const InvoiceEventKindSchema = z.enum(INVOICE_EVENT_KINDS);
export type InvoiceEventKind = z.infer<typeof InvoiceEventKindSchema>;

/**
 * Why a document a validated statement makes due is not issued (EQ-06): its invoice, for want of an accepted mandate,
 * of a regime the accountant validated, of a full identity, of a prefix or of the agency's identity; a credit note the
 * period owes, when no invoice can take it whole (ADR 0036). The statement stays validated and the owner is told
 * (`invoice_not_issued`).
 */
export const INVOICE_NOT_ISSUED_REASONS = [
  'no_mandate',
  'no_regime',
  'regime_not_validated',
  'identity_incomplete',
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
 * A document prints its regime's mentions and one of its own: an invoice its payment terms after them (art. L441-9 of
 * the Code de commerce), a credit note the invoice it cites before them (ADR 0036).
 */
export const INVOICE_DOCUMENT_MENTIONS_MAX = INVOICE_MENTIONS_MAX + 1;
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

/** A contest's reason, or the reason of its refusal: the contractor's or the owner's words, 1 to 500 characters. */
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
 * L526-22 and R526-27 of the Code de commerce). Those three are absent from a copy made before they existed (lot 4):
 * a frozen copy is printed as it was written.
 */
export const InvoiceContractorSchema = z.object({
  legalName: trimmed(LEGAL_NAME_MAX),
  address: trimmed(POSTAL_ADDRESS_MAX),
  country: CountryCodeSchema,
  taxId: trimmed(TAX_ID_MAX).nullable(),
  businessId: BusinessIdSchema.nullable().optional(),
  vatNumber: VatNumberSchema.nullable().optional(),
  individualEntrepreneur: z.boolean().optional(),
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
  email: z.email().max(BILLING_EMAIL_MAX),
  invoicePrefix: InvoicePrefixSchema.nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ContractorProfile = z.infer<typeof ContractorProfileSchema>;

/** A document of the regime, dated; the old one stays kept with the invoices it covered. */
export const ContractorDocumentSchema = z.object({
  id: ContractorDocumentIdSchema,
  memberId: TeamMemberIdSchema,
  kind: ContractorDocumentKindSchema,
  issuedOn: CalendarDaySchema,
  /** When the document bears its own end; otherwise its regime's duration gives it. */
  validUntil: CalendarDaySchema.nullable(),
  sha256: Sha256Schema,
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
 * R123-237 of the Code de commerce).
 */
export const BillingAgencyBodySchema = InvoiceAgencySchema.extend({
  legalForm: trimmed(AGENCY_LEGAL_FORM_MAX),
  shareCapitalMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  rcsCity: trimmed(RCS_CITY_MAX),
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
 *
 * `invoice_not_found` (unknown, or not the reader's), `invoice_answer_forbidden` (another's document to answer),
 * `payroll_forbidden` (a refusal by anyone but the owner), `invoice_acceptance_conflict` (a step its state or its
 * delay no longer allows, or another answer than the one recorded).
 */
export const InvoiceParamsSchema = z.object({ invoiceId: InvoiceIdSchema });

/** « Je conteste » : the contractor's reason. */
export const ContestInvoiceBodySchema = z.object({ reason: InvoiceReasonSchema });
export type ContestInvoiceBody = z.infer<typeof ContestInvoiceBodySchema>;

/** The owner refuses a contest, with the reason the contractor reads. */
export const RefuseInvoiceContestBodySchema = z.object({ reason: InvoiceReasonSchema });
export type RefuseInvoiceContestBody = z.infer<typeof RefuseInvoiceContestBodySchema>;

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
 * The refusals of the invoices' rules (EQ-06), each suffix setting its status (api.md). Kept apart from
 * `PAYROLL_ERROR_CODES` until the invoices' screens word them (lot 8).
 */
export const INVOICE_ERROR_CODES = [
  /** A logo the server refuses to keep, with its reason in `details.reason` (`AGENCY_LOGO_REFUSALS`). */
  'agency_logo_invalid',
  /** No logo was added with this fingerprint. */
  'agency_logo_not_found',
  'billing_regime_backdated_unprocessable',
  'credit_note_amount_unprocessable',
  'invoice_acceptance_conflict',
  /** Only the contractor answers their document: never the owner, a manager or another member (ADR 0039 § 1). */
  'invoice_answer_forbidden',
  /** The invoice does not exist, or is not the reader's. */
  'invoice_not_found',
  /** Its PDF is not rendered yet (« PDF en préparation », ADR 0037 § 5). */
  'invoice_pdf_not_found',
  /** Neither bucket gave the PDF with its fingerprint: never an altered file (ADR 0037 § 7). */
  'invoice_pdf_unavailable',
] as const;
export type InvoiceErrorCode = (typeof INVOICE_ERROR_CODES)[number];
