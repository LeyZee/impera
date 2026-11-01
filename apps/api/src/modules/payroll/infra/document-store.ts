import {
  calendarDayAt,
  ContractorDocumentDecisionSchema,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  type ContractorDocumentId,
  type TeamMemberId,
  type UploadContractorDocumentQuery,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withMember, type Database, type Transaction } from '@nirvana/db';

import { documentRetainUntil, documentStorageKey, documentUploadLockUntil } from '../domain/documents';
import {
  ContractorDocumentIdConflict,
  ContractorDocumentIssuedAhead,
  ContractorDocumentNotFound,
  ContractorDocumentReviewed,
  ContractorProfileForbidden,
  PayrollForbidden,
  TeamMemberNotFound,
} from '../domain/errors';
import type { Actor, PayrollDocumentStore } from '../domain/ports';

import { documentOf, mediaTypeOfRow } from './document-rows';
import { enqueueInvoiceRequeue } from './invoice-queue';
import type { PayInputReads } from './snapshot';
import { audit } from './writes';

const { billingSettings, contractorDocumentReviews, contractorDocuments, teamMembers } = schema;

type DocumentRow = typeof contractorDocuments.$inferSelect;
type ReviewRow = typeof contractorDocumentReviews.$inferSelect;

/** The member as the reader's policy lets him see it. */
async function memberOf(
  tx: Transaction,
  memberId: TeamMemberId,
): Promise<{ readonly userId: string | null }> {
  const [row] = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.id, memberId));
  if (row === undefined) throw new TeamMemberNotFound();
  return row;
}

/** A document is part of the file: the contractor himself or the owner files it (`member_insert` says it again). */
function assertWriter(scope: string, member: { readonly userId: string | null }, actor: Actor): void {
  if (scope !== 'owner' && member.userId !== actor.userId) throw new ContractorProfileForbidden();
}

async function lock(tx: Transaction, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** The member's document under this id, with its check, as the reader sees it. */
async function documentById(
  tx: Transaction,
  memberId: TeamMemberId,
  documentId: ContractorDocumentId,
): Promise<{ readonly row: DocumentRow; readonly review: ReviewRow | null } | null> {
  const [found] = await tx
    .select({ row: contractorDocuments, review: contractorDocumentReviews })
    .from(contractorDocuments)
    .leftJoin(contractorDocumentReviews, eq(contractorDocumentReviews.documentId, contractorDocuments.id))
    .where(and(eq(contractorDocuments.id, documentId), eq(contractorDocuments.memberId, memberId)));
  return found ?? null;
}

/**
 * The document already recorded under the upload's `id`: the same file and dates give it back, others are a conflict.
 * An id the writer cannot see (another contractor's document) is found by the insert, which refuses it.
 */
async function recordedUnder(
  tx: Transaction,
  memberId: TeamMemberId,
  query: UploadContractorDocumentQuery,
  sha256: string,
): Promise<{ readonly row: DocumentRow; readonly review: ReviewRow | null } | null> {
  const [found] = await tx
    .select({ row: contractorDocuments, review: contractorDocumentReviews })
    .from(contractorDocuments)
    .leftJoin(contractorDocumentReviews, eq(contractorDocumentReviews.documentId, contractorDocuments.id))
    .where(eq(contractorDocuments.id, query.id));
  if (found === undefined) return null;
  const { row } = found;
  const same =
    row.memberId === memberId &&
    row.kind === query.kind &&
    row.issuedOn === query.issuedOn &&
    row.validUntil === (query.validUntil ?? null) &&
    row.sha256 === sha256;
  if (!same) throw new ContractorDocumentIdConflict();
  return found;
}

/**
 * A contractor's documents (EQ-06 lot 5c): see `PayrollDocumentStore`. Today is the agency's calendar day: a document
 * is never issued after it, and an acceptance counts from it.
 */
export function createDrizzlePayrollDocumentStore(
  db: Database,
  reads: Pick<PayInputReads, 'agencyTimeZone'>,
  now: () => Date,
): PayrollDocumentStore {
  const today = async (tx: Transaction): Promise<string> =>
    calendarDayAt(now(), await reads.agencyTimeZone(tx));
  const assertIssued = async (tx: Transaction, issuedOn: string): Promise<void> => {
    if (issuedOn > (await today(tx))) throw new ContractorDocumentIssuedAhead(issuedOn);
  };
  return {
    prepareUpload: (actor, memberId, query, file) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertWriter(scope, await memberOf(tx, memberId), actor);
        const recorded = await recordedUnder(tx, memberId, query, file.sha256);
        if (recorded !== null) {
          return { kind: 'recorded', document: documentOf(recorded.row, recorded.review) } as const;
        }
        await assertIssued(tx, query.issuedOn);
        return {
          kind: 'new',
          key: documentStorageKey(memberId, query.id, file.mediaType),
          lockUntil: documentUploadLockUntil(now()),
        } as const;
      }),

    recordUpload: (actor, memberId, query, file) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertWriter(scope, await memberOf(tx, memberId), actor);
        await lock(tx, `contractor_documents:${query.id}`);
        const recorded = await recordedUnder(tx, memberId, query, file.sha256);
        if (recorded !== null) return { document: documentOf(recorded.row, recorded.review), created: false };
        await assertIssued(tx, query.issuedOn);
        const [row] = await tx
          .insert(contractorDocuments)
          .values({
            id: query.id,
            memberId,
            kind: query.kind,
            issuedOn: query.issuedOn,
            validUntil: query.validUntil ?? null,
            storageKey: file.key,
            sha256: file.sha256,
            retainUntil: file.lockUntil,
            createdBy: actor.userId,
          })
          .onConflictDoNothing()
          .returning();
        // The id of a document the writer does not see.
        if (row === undefined) throw new ContractorDocumentIdConflict();
        // Its dates and its fingerprint, never its file: a document holds personal data.
        await audit(
          tx,
          actor,
          'contractor_document.add',
          { kind: 'contractor_document', id: query.id },
          {
            memberId,
            kind: query.kind,
            issuedOn: query.issuedOn,
            validUntil: query.validUntil ?? null,
            mediaType: file.mediaType,
            sha256: file.sha256,
          },
        );
        // Under a treaty his statements wait for this certificate: tried again, the owner is told it waits for him.
        if (query.kind === 'tax_residence') await enqueueInvoiceRequeue(tx, memberId);
        return { document: documentOf(row, null), created: true };
      }),

    documentFor: (userId, memberId, documentId) =>
      withMember(db, userId, async (tx) => {
        const found = await documentById(tx, memberId, documentId);
        if (found === null) return null;
        return {
          document: documentOf(found.row, found.review),
          file: { key: found.row.storageKey, sha256: found.row.sha256, mediaType: mediaTypeOfRow(found.row) },
        };
      }),

    review: (actor, memberId, documentId, body, secure) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        const member = await memberOf(tx, memberId);
        // Never his own document: the policy `owner_insert` says it again.
        if (member.userId === actor.userId) throw new PayrollForbidden({ ownerOnly: true });
        await lock(tx, `contractor_document_review:${documentId}`);
        const found = await documentById(tx, memberId, documentId);
        if (found === null) throw new ContractorDocumentNotFound();
        const { row } = found;
        if (found.review !== null) {
          const same =
            found.review.decision === body.decision &&
            found.review.reason === (body.decision === 'refused' ? body.reason : null);
          if (!same) {
            throw new ContractorDocumentReviewed(
              ContractorDocumentDecisionSchema.parse(found.review.decision),
            );
          }
          return { document: documentOf(row, found.review), created: false };
        }
        let retainUntil: Date | null = null;
        if (body.decision === 'accepted') {
          const [settings] = await tx
            .select({ fiscalYearEndMonth: billingSettings.fiscalYearEndMonth })
            .from(billingSettings)
            .limit(1);
          const due = documentRetainUntil(
            documentOf(row, null).lastDay,
            await today(tx),
            settings?.fiscalYearEndMonth ?? DEFAULT_FISCAL_YEAR_END_MONTH,
          );
          // A compliance lock only lengthens.
          retainUntil = due.getTime() > row.retainUntil.getTime() ? due : row.retainUntil;
        }
        const [review] = await tx
          .insert(contractorDocumentReviews)
          .values({
            documentId,
            decision: body.decision,
            reason: body.decision === 'refused' ? body.reason : null,
            reviewedBy: actor.userId,
            reviewedAt: now(),
            retainUntil,
          })
          .returning();
        if (review === undefined) throw new Error('contractor_document_reviews: insert returned no row');
        await audit(
          tx,
          actor,
          'contractor_document.review',
          { kind: 'contractor_document', id: documentId },
          { memberId, decision: body.decision, retainUntil: retainUntil?.toISOString() ?? null },
        );
        if (row.kind === 'tax_residence') await enqueueInvoiceRequeue(tx, memberId);
        // Last, once every write of the base has passed (Bilan on #355): a bucket that refuses rolls the check back,
        // and the owner tries again; a write of the base that fails never leaves a file locked ten years for nothing.
        if (retainUntil !== null) {
          await secure(
            { key: row.storageKey, sha256: row.sha256, mediaType: mediaTypeOfRow(row) },
            retainUntil,
          );
        }
        return { document: documentOf(row, review), created: true };
      }),
  };
}
