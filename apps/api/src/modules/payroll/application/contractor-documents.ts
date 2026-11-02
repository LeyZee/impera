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
  ContractorDocumentFileGone,
  ContractorDocumentIdConflict,
  ContractorDocumentNotFound,
  ContractorDocumentUnavailable,
  InvoiceStorageRefused,
  InvoiceStorageUnavailable,
} from '../domain/errors';
import type {
  Actor,
  InvoiceObjectStore,
  JobLogger,
  PayrollDocumentPurgeStore,
  PayrollDocumentReminderStore,
  PayrollDocumentStore,
} from '../domain/ports';

import { lockAtLeast, readChecked, sha256Hex } from './locked-objects';

/**
 * A contractor's documents (EQ-06 lot 5c): the file in the first bucket of the invoices, under its own key, written
 * once; the row in the base, which names it with its fingerprint. Once the owner accepts it, the file is copied to the
 * second bucket under the same key and lock, as a PDF is (ADR 0037 § 6): it justifies invoices as long as they are
 * kept. The file is served only when its bytes are those the row names, from the copy when the first bucket fails. A
 * bucket that does not answer is a passing failure (`contractor_document_unavailable`).
 */
export interface ContractorDocumentDeps {
  readonly store: PayrollDocumentStore;
  /** The locked bucket of ADR 0028, at Hetzner: every document filed. */
  readonly primary: InvoiceObjectStore;
  /** The second copy (ADR 0037 § 6), at OVHcloud: the documents the owner accepted. */
  readonly copy: InvoiceObjectStore;
}

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
    deps.primary.writeOnce(plan.key, bytes, sha256, plan.lockUntil, mediaType),
  );
  let lockUntil = plan.lockUntil;
  if (written === 'exists') {
    const found = await reached(() => deps.primary.read(plan.key));
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
 * owner, an active manager): the bytes only when their SHA-256 is the row's, from the first bucket, or from the copy
 * for an accepted document when the first fails. A file gone or altered is never served and is logged as an error; a
 * store in memory that forgot it with the process (development) is only out of reach.
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
  const { document, file } = found;
  // Erased once refused and unlocked (« ok purge a »): said so, never taken for a bucket that lost it.
  if (document.purgedAt !== null) throw new ContractorDocumentFileGone();
  const served = (bytes: Uint8Array): DownloadedDocument => ({
    fileName: `${document.kind}-${document.issuedOn}.${documentExtension(file.mediaType)}`,
    mediaType: file.mediaType,
    bytes,
  });
  const wrong = (place: 'primary' | 'copy'): void => {
    logger.error(
      { documentId, key: file.key, place },
      'contractor document: a bucket does not hold the file the row names, nothing served from it',
    );
  };
  const first = await readChecked(deps.primary, file.key, file.sha256);
  if (first.kind === 'ok') return served(first.bytes);
  if (first.kind === 'wrong') wrong('primary');
  // Only an accepted document has a copy.
  if (document.review?.decision !== 'accepted') throw new ContractorDocumentUnavailable();
  const second = await readChecked(deps.copy, file.key, file.sha256);
  if (second.kind === 'ok') {
    logger.warn({ documentId, first: first.kind }, 'contractor document: served from the copy');
    return served(second.bytes);
  }
  if (second.kind === 'wrong') wrong('copy');
  throw new ContractorDocumentUnavailable();
}

/**
 * The file the owner accepts, kept as long as the invoices it may cover, last in the check's transaction: in the first
 * bucket as filed (its fingerprint read back, its lock lengthened), then in the second, written once under the same
 * key and lock (or found there from an attempt that did not commit, with the same fingerprint, its lock lengthened).
 * Anything else is logged and refused as a passing failure: the check rolls back and the owner tries again.
 */
async function secureAccepted(
  deps: ContractorDocumentDeps,
  file: { readonly key: string; readonly sha256: string; readonly mediaType: ContractorDocumentMediaType },
  retainUntil: Date,
  logger: JobLogger,
): Promise<void> {
  const refuse = (place: 'primary' | 'copy', why: string, error?: unknown): never => {
    logger.error(
      { key: file.key, place, err: error },
      `contractor document: ${why}, the check is not recorded`,
    );
    throw new ContractorDocumentUnavailable();
  };
  const holds = (
    found: { readonly bytes: Uint8Array; readonly retainUntil: Date | null } | null,
  ): found is { readonly bytes: Uint8Array; readonly retainUntil: Date } =>
    found !== null && found.retainUntil !== null && sha256Hex(found.bytes) === file.sha256;
  let place: 'primary' | 'copy' = 'primary';
  try {
    const filed = await deps.primary.read(file.key);
    if (!holds(filed)) return refuse(place, 'the first bucket does not hold the file as filed, under a lock');
    await lockAtLeast(deps.primary, file.key, filed.retainUntil, retainUntil, logger);
    place = 'copy';
    let copied = await deps.copy.read(file.key);
    if (copied === null) {
      const written = await deps.copy.writeOnce(
        file.key,
        filed.bytes,
        file.sha256,
        retainUntil,
        file.mediaType,
      );
      if (written === 'written') return;
      copied = await deps.copy.read(file.key);
    }
    if (!holds(copied)) return refuse(place, 'the copy holds another file under this key, or no lock');
    await lockAtLeast(deps.copy, file.key, copied.retainUntil, retainUntil, logger);
  } catch (error) {
    if (error instanceof ContractorDocumentUnavailable) throw error;
    return refuse(place, 'a bucket refused the file or its lock', error);
  }
}

/**
 * `POST /v1/payroll/contractors/:memberId/documents/:documentId/review`: the owner's check, once. An acceptance
 * secures its file in both buckets last in the check's transaction: a bucket that refuses records nothing.
 */
function reviewContractorDocument(
  deps: ContractorDocumentDeps,
  actor: Actor,
  memberId: TeamMemberId,
  documentId: ContractorDocumentId,
  body: ContractorDocumentReview,
  logger: JobLogger,
): Promise<{ document: ContractorDocument; created: boolean }> {
  return deps.store.review(actor, memberId, documentId, body, (file, retainUntil) =>
    secureAccepted(deps, file, retainUntil, logger),
  );
}

/** The documents' three routes, on their store and buckets. */
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
    logger: JobLogger,
  ): Promise<{ document: ContractorDocument; created: boolean }>;
}

export function createContractorDocuments(deps: ContractorDocumentDeps): ContractorDocuments {
  return {
    upload: (actor, memberId, query, bytes) => uploadContractorDocument(deps, actor, memberId, query, bytes),
    download: (userId, memberId, documentId, logger) =>
      downloadContractorDocument(deps, userId, memberId, documentId, logger),
    review: (actor, memberId, documentId, body, logger) =>
      reviewContractorDocument(deps, actor, memberId, documentId, body, logger),
  };
}

/**
 * `payroll.remind_documents`, each hour (EQ-06 lot 5c-2): each document a contractor's regime asks for that comes to
 * its end, or passed it, with no newer one filed, is said once to the owner (`contractor_document_expiring`): a tax
 * residence certificate from 1 December of its year, the others from the owner's delay before their last day. Returns
 * how many were said this run.
 */
export function remindDocuments(store: PayrollDocumentReminderStore): Promise<number> {
  return store.remindUnscoped();
}

/** What a night of `payroll.purge_refused_documents` did. */
export interface PurgeOutcome {
  /** Erasures recorded: files erased, or already absent from the bucket. */
  readonly purged: number;
  /** Files left for a later night: a lock the bucket still names, a bucket that did not answer, another file. */
  readonly skipped: number;
}

/**
 * `payroll.purge_refused_documents`, each night (EQ-06 lot 5c-2, « ok purge a » de Charles, 01/11): each refused
 * document whose upload lock has ended has its file erased from the first bucket, every version by its id, once the
 * bucket shows it is the file of the row and its lock has ended; then, and only then, the erasure is recorded. A run
 * stopped between the two finds the file absent and records it. The second bucket is never written: a refused
 * document is never copied there, and one found there fails the run, nothing erased from it.
 */
export async function purgeRefusedDocuments(
  deps: {
    readonly store: PayrollDocumentPurgeStore;
    readonly primary: InvoiceObjectStore;
    readonly copy: InvoiceObjectStore;
  },
  logger: JobLogger,
): Promise<PurgeOutcome> {
  let purged = 0;
  let skipped = 0;
  const copied: string[] = [];
  let refused = 0;
  for (const file of await deps.store.dueUnscoped()) {
    const context = { documentId: file.documentId, memberId: file.memberId };
    try {
      if (await deps.copy.holdsVersion(file.key)) {
        copied.push(file.documentId);
        logger.error(context, 'contractor document purge: a refused document has a copy, nothing erased');
        continue;
      }
      const outcome = await deps.primary.remove(file.key, file.sha256);
      if (outcome === 'removed' || outcome === 'absent') {
        if (await deps.store.recordUnscoped(file, outcome)) purged += 1;
        continue;
      }
      skipped += 1;
      if (outcome === 'locked') {
        logger.warn(
          context,
          'contractor document purge: the bucket names a lock that holds, tried again later',
        );
      } else {
        logger.error(context, 'contractor document purge: the bucket holds another file, nothing erased');
      }
    } catch (error) {
      if (error instanceof InvoiceStorageRefused) {
        // A missing right, not a lock (Bilan on #359): said as an error each night, and the run fails.
        skipped += 1;
        refused += 1;
        logger.error(
          { ...context, error: error.message },
          'contractor document purge: the bucket refused to erase a version whose lock has ended',
        );
        continue;
      }
      if (!(error instanceof InvoiceStorageUnavailable)) throw error;
      skipped += 1;
      logger.warn({ ...context, error: error.message }, 'contractor document purge: a bucket did not answer');
    }
  }
  const failures = [
    ...(copied.length > 0 ? [`${String(copied.length)} refused document(s) found in the second bucket`] : []),
    ...(refused > 0
      ? [`${String(refused)} erasure(s) refused by the first bucket with no lock that holds`]
      : []),
  ];
  if (failures.length > 0) throw new Error(`contractor document purge: ${failures.join('; ')}`);
  return { purged, skipped };
}
