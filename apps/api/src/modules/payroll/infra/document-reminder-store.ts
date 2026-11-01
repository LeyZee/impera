import {
  AuditEntryIdSchema,
  calendarDayAt,
  ContractorDocumentKindSchema,
  DEFAULT_DOCUMENT_REMINDER_DAYS,
  EventIdSchema,
  EVENT_PAYLOADS,
  newId,
  type ContractorDocumentKind,
  type ContractorDocumentReview,
} from '@nirvana/contracts';
import { eq, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';

import { documentsToRemind, documentValidUntil, regimeOn } from '../domain/billing';
import type { PayrollDocumentReminderStore } from '../domain/ports';

import { reviewOf } from './document-rows';
import type { PayInputReads } from './snapshot';

const {
  auditLog,
  billingRegimes,
  billingSettings,
  contractorDocumentReviews,
  contractorDocuments,
  contractorRegimes,
  domainEvents,
  teamMembers,
} = schema;

/** A document as the reminder reads it: what `documentsToRemind` needs, and what the event names. */
interface Filed {
  readonly id: string;
  readonly memberId: string;
  readonly kind: ContractorDocumentKind;
  readonly issuedOn: string;
  readonly validUntil: string | null;
  readonly review: ContractorDocumentReview | null;
}

/** Whether `contractor_document_expiring` was already said for this document, read under its lock. */
async function said(tx: Transaction, documentId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: domainEvents.id })
    .from(domainEvents)
    .where(
      // Both written out, the type as a literal: the planner reads them through the partial index of 0055.
      sql`${domainEvents.type} = 'contractor_document_expiring' and ${domainEvents.payload}->>'documentId' = ${documentId}`,
    )
    .limit(1);
  return row !== undefined;
}

/**
 * `payroll.remind_documents` (EQ-06 lot 5c-2): see `PayrollDocumentReminderStore`. One transaction for the run; each
 * document under its advisory lock, read then written, so that two runs at once say it once. A member who left is
 * never reminded; one on leave or sick still is: his statements are still invoiced.
 */
export function createDrizzleDocumentReminderStore(
  adminDb: Database,
  reads: Pick<PayInputReads, 'agencyTimeZone'>,
  now: () => Date,
): PayrollDocumentReminderStore {
  return {
    remindUnscoped: () =>
      withAdmin(adminDb, async (tx) => {
        const at = now();
        const today = calendarDayAt(at, await reads.agencyTimeZone(tx));
        const [settings] = await tx
          .select({ reminderDays: billingSettings.documentReminderDays })
          .from(billingSettings)
          .limit(1);
        const reminderDays = settings?.reminderDays ?? DEFAULT_DOCUMENT_REMINDER_DAYS;
        const members = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(sql`${teamMembers.status} <> 'left'`)
          // One order for every run: two runs at once take the documents' locks in the same order.
          .orderBy(teamMembers.id);
        const assignments = await tx
          .select({
            memberId: contractorRegimes.memberId,
            regimeId: contractorRegimes.regimeId,
            from: contractorRegimes.effectiveFrom,
          })
          .from(contractorRegimes);
        const regimes = new Map(
          (
            await tx
              .select({ id: billingRegimes.id, documents: billingRegimes.documents })
              .from(billingRegimes)
          ).map((row) => [
            row.id,
            { documents: row.documents.map((kind) => ContractorDocumentKindSchema.parse(kind)) },
          ]),
        );
        const filed: Filed[] = (
          await tx
            .select({
              id: contractorDocuments.id,
              memberId: contractorDocuments.memberId,
              kind: contractorDocuments.kind,
              issuedOn: contractorDocuments.issuedOn,
              validUntil: contractorDocuments.validUntil,
              decision: contractorDocumentReviews.decision,
              reason: contractorDocumentReviews.reason,
            })
            .from(contractorDocuments)
            .leftJoin(
              contractorDocumentReviews,
              eq(contractorDocumentReviews.documentId, contractorDocuments.id),
            )
        ).map((row) => ({
          id: row.id,
          memberId: row.memberId,
          kind: ContractorDocumentKindSchema.parse(row.kind),
          issuedOn: row.issuedOn,
          validUntil: row.validUntil,
          review: reviewOf(row),
        }));

        let count = 0;
        for (const member of members) {
          const assignment = regimeOn(
            assignments.filter((one) => one.memberId === member.id),
            today,
          );
          const regime = assignment === null ? null : (regimes.get(assignment.regimeId) ?? null);
          const due = documentsToRemind(
            regime,
            filed.filter((one) => one.memberId === member.id),
            today,
            reminderDays,
          );
          for (const document of due) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`contractor_document_expiring:${document.id}`}, 0))`,
            );
            if (await said(tx, document.id)) continue;
            const payload = EVENT_PAYLOADS.contractor_document_expiring.parse({
              memberId: member.id,
              documentId: document.id,
              kind: document.kind,
              lastDay: documentValidUntil(document),
            });
            await tx.insert(domainEvents).values({
              id: newId(EventIdSchema),
              creatorId: null,
              type: 'contractor_document_expiring',
              payload,
              actor: 'system',
              correlationId: `payroll.remind_documents:${document.id}`,
              createdAt: at,
            });
            // Its dates and its kind, never its file nor a name: a document holds personal data.
            await tx.insert(auditLog).values({
              id: newId(AuditEntryIdSchema),
              userId: null,
              action: 'contractor_document.remind',
              entity: 'contractor_document',
              entityId: document.id,
              details: { memberId: member.id, kind: document.kind, lastDay: payload.lastDay, today },
              ip: null,
            });
            count += 1;
          }
        }
        return count;
      }),
  };
}
