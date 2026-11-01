import { createHash } from 'node:crypto';

import type {
  ContractorDocument,
  ContractorDocumentId,
  ContractorDocumentMediaType,
  ContractorDocumentReview,
  TeamMemberId,
  UploadContractorDocumentQuery,
  UserId,
} from '@nirvana/contracts';

import { documentExtension, documentMediaTypeOf } from '../domain/documents';
import {
  ContractorDocumentIdConflict,
  ContractorDocumentNotFound,
  ContractorDocumentUnavailable,
  InvoiceStorageUnavailable,
} from '../domain/errors';
import type { Actor, InvoiceObjectStore, JobLogger, PayrollDocumentStore } from '../domain/ports';

/**
 * A contractor's documents (EQ-06 lot 5c): the file in the first bucket of the invoices, under its own key, written
 * once; the row in the base, which names it with its fingerprint. The file is served only when its bytes are those
 * the row names. A bucket that does not answer is a passing failure (`contractor_document_unavailable`).
 */
export interface ContractorDocumentDeps {
  readonly store: PayrollDocumentStore;
  readonly bucket: InvoiceObjectStore;
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A bucket that does not answer, said to the client as a passing failure; anything else is thrown as it is. */
async function reached<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof InvoiceStorageUnavailable) throw new ContractorDocumentUnavailable();
    throw error;
  }
}

/**
 * `POST /v1/payroll/contractors/:memberId/documents`: checks the file (what it is, its weight), then the writer and the
 * dates, writes the file once, and records the document. Sent again with the same `id` and file, it gives back what was
 * recorded; a run stopped after the bucket finds its object there and records it with the lock the bucket names.
 */
async function uploadContractorDocument(
  deps: ContractorDocumentDeps,
  actor: Actor,
  memberId: TeamMemberId,
  query: UploadContractorDocumentQuery,
  bytes: Uint8Array,
): Promise<{ document: ContractorDocument; created: boolean }> {
  const mediaType = documentMediaTypeOf(bytes);
  const sha256 = sha256Hex(bytes);
  const plan = await deps.store.prepareUpload(actor, memberId, query, { sha256, mediaType });
  if (plan.kind === 'recorded') return { document: plan.document, created: false };
  const written = await reached(() =>
    deps.bucket.writeOnce(plan.key, bytes, sha256, plan.lockUntil, mediaType),
  );
  let lockUntil = plan.lockUntil;
  if (written === 'exists') {
    const found = await reached(() => deps.bucket.read(plan.key));
    // Another file under this key: the same id sent with other bytes while the first was still on its way.
    if (found === null || sha256Hex(found.bytes) !== sha256) throw new ContractorDocumentIdConflict();
    // A lock the bucket does not name is never taken for one that holds: the client sends again.
    if (found.retainUntil === null) throw new ContractorDocumentUnavailable();
    lockUntil = found.retainUntil;
  }
  return deps.store.recordUpload(actor, memberId, query, { key: plan.key, sha256, mediaType, lockUntil });
}

/** A document's file as served: its bytes, checked against their fingerprint, what it is, and a name for it. */
interface DownloadedDocument {
  readonly fileName: string;
  readonly mediaType: ContractorDocumentMediaType;
  readonly bytes: Uint8Array;
}

/**
 * `GET /v1/payroll/contractors/:memberId/documents/:documentId/file`, under the document's policy (the contractor, the
 * owner, an active manager): the bytes only when their SHA-256 is the row's. A file gone or altered is never served
 * and is logged as an error; a store in memory that forgot it with the process (development) is only out of reach.
 */
async function downloadContractorDocument(
  deps: ContractorDocumentDeps,
  userId: UserId,
  memberId: TeamMemberId,
  documentId: ContractorDocumentId,
  logger: JobLogger,
): Promise<DownloadedDocument> {
  const found = await deps.store.documentFor(userId, memberId, documentId);
  if (found === null) throw new ContractorDocumentNotFound();
  const object = await reached(() => deps.bucket.read(found.file.key));
  if (object === null || sha256Hex(object.bytes) !== found.file.sha256) {
    if (!(object === null && deps.bucket.volatile)) {
      logger.error(
        { documentId, key: found.file.key, found: object === null ? null : sha256Hex(object.bytes) },
        'contractor document: the bucket does not hold the file the row names, nothing served',
      );
    }
    throw new ContractorDocumentUnavailable();
  }
  const { document } = found;
  return {
    fileName: `${document.kind}-${document.issuedOn}.${documentExtension(found.file.mediaType)}`,
    mediaType: found.file.mediaType,
    bytes: object.bytes,
  };
}

/**
 * `POST /v1/payroll/contractors/:memberId/documents/:documentId/review`: the owner's check, once. An acceptance first
 * lengthens the file's lock in the bucket, in the check's transaction: a bucket that refuses records nothing.
 */
function reviewContractorDocument(
  deps: ContractorDocumentDeps,
  actor: Actor,
  memberId: TeamMemberId,
  documentId: ContractorDocumentId,
  body: ContractorDocumentReview,
): Promise<{ document: ContractorDocument; created: boolean }> {
  return deps.store.review(actor, memberId, documentId, body, (key, retainUntil) =>
    reached(() => deps.bucket.lengthenLock(key, retainUntil)),
  );
}

/** The documents' three routes, on their store and bucket. */
export interface ContractorDocuments {
  upload(
    actor: Actor,
    memberId: TeamMemberId,
    query: UploadContractorDocumentQuery,
    bytes: Uint8Array,
  ): Promise<{ document: ContractorDocument; created: boolean }>;
  download(
    userId: UserId,
    memberId: TeamMemberId,
    documentId: ContractorDocumentId,
    logger: JobLogger,
  ): Promise<DownloadedDocument>;
  review(
    actor: Actor,
    memberId: TeamMemberId,
    documentId: ContractorDocumentId,
    body: ContractorDocumentReview,
  ): Promise<{ document: ContractorDocument; created: boolean }>;
}

export function createContractorDocuments(deps: ContractorDocumentDeps): ContractorDocuments {
  return {
    upload: (actor, memberId, query, bytes) => uploadContractorDocument(deps, actor, memberId, query, bytes),
    download: (userId, memberId, documentId, logger) =>
      downloadContractorDocument(deps, userId, memberId, documentId, logger),
    review: (actor, memberId, documentId, body) =>
      reviewContractorDocument(deps, actor, memberId, documentId, body),
  };
}
