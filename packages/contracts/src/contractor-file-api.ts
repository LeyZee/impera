import { z } from 'zod';

import {
  ContractAcceptanceSchema,
  ContractTextSchema,
  ContractorDocumentSchema,
  ContractorProfileSchema,
} from './contractor-file';
import { ContractTextIdSchema, ContractorDocumentIdSchema, TeamMemberIdSchema } from './ids';
import {
  CONTEST_DELAY_MAX_DAYS,
  CONTRACT_TEXT_MAX,
  InvoicePrefixSchema,
  Sha256Schema,
  frenchVatNumberOf,
  sirenChecksOut,
} from './invoices-fields';
import { ContractorRegimeSchema } from './invoices-parties';
import { ContractorDocumentKindSchema } from './invoices-vocabulary';
import { CountryCodeSchema } from './team';
import { CalendarDaySchema, TeamMemberSchema } from './team-members';

/**
 * The contractor's file through the routes (EQ-06): bodies, params, queries and views of the file, its documents and
 * texts.
 */

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
