import { z } from 'zod';

import {
  ContractAcceptanceIdSchema,
  ContractTextIdSchema,
  ContractorDocumentIdSchema,
  TeamMemberIdSchema,
} from './ids';
import {
  AGENCY_LEGAL_FORM_MAX,
  BILLING_EMAIL_MAX,
  BusinessIdSchema,
  CONTEST_DELAY_MAX_DAYS,
  CONTRACT_TEXT_MAX,
  InvoicePrefixSchema,
  LEGAL_NAME_MAX,
  POSTAL_ADDRESS_MAX,
  RCS_CITY_MAX,
  Sha256Schema,
  TAX_ID_MAX,
  VatNumberSchema,
} from './invoices-fields';
import { trimmed } from './invoices-internal';
import { ContractTextKindSchema, ContractorDocumentKindSchema } from './invoices-vocabulary';
import { CalendarDaySchema } from './team-members';

/**
 * The contractor's file as the base keeps it (EQ-06): profile, documents and their review, contract texts and
 * acceptances.
 */

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
