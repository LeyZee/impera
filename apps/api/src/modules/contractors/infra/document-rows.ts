import {
  ContractorDocumentKindSchema,
  ContractorDocumentReviewedSchema,
  ContractorDocumentReviewSchema,
  ContractorDocumentSchema,
  type ContractorDocument,
  type ContractorDocumentMediaType,
  type ContractorDocumentReview,
  type ContractorDocumentReviewed,
} from '@impera/contracts';
import type { schema } from '@impera/db';

import { documentValidUntil } from '../domain/billing';
import { documentMediaTypeOfKey } from '../domain/documents';

type DocumentRow = typeof schema.contractorDocuments.$inferSelect;
type ReviewRow = typeof schema.contractorDocumentReviews.$inferSelect;
type PurgeRow = typeof schema.contractorDocumentPurges.$inferSelect;

/**
 * The owner's check of a document as its row holds it (`contractor_document_reviews`, lot 5c), `null` while it waits:
 * the base keeps a refusal with its reason and an acceptance without one (its CHECK).
 */
export function reviewOf(row: {
  readonly decision: string | null;
  readonly reason: string | null;
}): ContractorDocumentReview | null {
  if (row.decision === null) return null;
  return ContractorDocumentReviewSchema.parse(
    row.decision === 'refused' ? { decision: row.decision, reason: row.reason } : { decision: row.decision },
  );
}

/** The check as the file shows it, with its instant. */
function reviewedOf(row: ReviewRow): ContractorDocumentReviewed {
  return ContractorDocumentReviewedSchema.parse({
    ...reviewOf(row),
    reviewedAt: row.reviewedAt.toISOString(),
  });
}

/** What a document's file is, from the key this module wrote (`documentStorageKey`). */
export function mediaTypeOfRow(row: Pick<DocumentRow, 'storageKey'>): ContractorDocumentMediaType {
  const mediaType = documentMediaTypeOfKey(row.storageKey);
  if (mediaType === null)
    throw new Error(`contractor_documents: a key this module never wrote (${row.storageKey})`);
  return mediaType;
}

/**
 * A document as the file shows it: its dates, its last day, what its file is, the owner's check, and when its file was
 * erased (a refused document, « ok purge a »).
 */
export function documentOf(
  row: DocumentRow,
  review: ReviewRow | null,
  purge: PurgeRow | null,
): ContractorDocument {
  const kind = ContractorDocumentKindSchema.parse(row.kind);
  return ContractorDocumentSchema.parse({
    id: row.id,
    memberId: row.memberId,
    kind,
    issuedOn: row.issuedOn,
    validUntil: row.validUntil,
    lastDay: documentValidUntil({ kind, issuedOn: row.issuedOn, validUntil: row.validUntil }),
    mediaType: mediaTypeOfRow(row),
    sha256: row.sha256,
    review: review === null ? null : reviewedOf(review),
    purgedAt: purge?.purgedAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}
