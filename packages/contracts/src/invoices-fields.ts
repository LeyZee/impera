import { z } from 'zod';

import { trimmed } from './invoices-internal';

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
