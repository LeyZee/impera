import { AuditEntryIdSchema, ContractorDocumentIdSchema, newId, TeamMemberIdSchema } from '@impera/contracts';
import { schema, sql, withAdmin, type Database } from '@impera/db';

import type { PayrollDocumentPurgeStore } from '../domain/ports';

const { auditLog, contractorDocumentPurges, contractorDocumentReviews, contractorDocuments } = schema;

/** One night's batch at most: the next night takes the rest. */
const PURGE_BATCH = 200;

/**
 * `payroll.purge_refused_documents` (EQ-06 lot 5c-2, « ok purge a » de Charles, 01/11): see `PayrollDocumentPurgeStore`.
 * The base's clock says when an upload lock has ended, as its trigger `keep_contractor_document_purge` does.
 */
export function createDrizzleDocumentPurgeStore(adminDb: Database): PayrollDocumentPurgeStore {
  return {
    dueUnscoped: () =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            documentId: contractorDocuments.id,
            memberId: contractorDocuments.memberId,
            key: contractorDocuments.storageKey,
            sha256: contractorDocuments.sha256,
          })
          .from(contractorDocuments)
          .innerJoin(
            contractorDocumentReviews,
            sql`${contractorDocumentReviews.documentId} = ${contractorDocuments.id}`,
          )
          .where(
            sql`${contractorDocumentReviews.decision} = 'refused' and ${contractorDocuments.retainUntil} <= now() and not exists (select 1 from ${contractorDocumentPurges} where ${contractorDocumentPurges.documentId} = ${contractorDocuments.id})`,
          )
          .orderBy(contractorDocuments.retainUntil, contractorDocuments.id)
          .limit(PURGE_BATCH);
        return rows.map((row) => ({
          documentId: ContractorDocumentIdSchema.parse(row.documentId),
          memberId: TeamMemberIdSchema.parse(row.memberId),
          key: row.key,
          sha256: row.sha256,
        }));
      }),

    recordUnscoped: (file, outcome) =>
      withAdmin(adminDb, async (tx) => {
        const [recorded] = await tx
          .insert(contractorDocumentPurges)
          .values({ documentId: file.documentId })
          .onConflictDoNothing()
          .returning({ documentId: contractorDocumentPurges.documentId });
        if (recorded === undefined) return false;
        // Its kind of answer and the member, never the file nor its key: what was erased stays erased.
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: 'contractor_document.purge',
          entity: 'contractor_document',
          entityId: file.documentId,
          details: { memberId: file.memberId, outcome },
          ip: null,
        });
        return true;
      }),
  };
}
