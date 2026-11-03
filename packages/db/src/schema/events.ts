import { EVENT_TYPES } from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, enumCheck, enumText, hiddenFromCreator, id, tenantPolicy } from './columns';
import { creators } from './tenancy';

/** Outbox for what does not belong to one conversation (append-only, same closed list of types). */
export const domainEvents = pgTable(
  'domain_events',
  {
    id: id(),
    creatorId: uuid('creator_id').references(() => creators.id),
    type: enumText('type').notNull(),
    payload: jsonb('payload').notNull(),
    actor: text('actor').notNull(),
    correlationId: text('correlation_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('domain_events', t.type, EVENT_TYPES),
    index('domain_events_created_idx').on(t.createdAt),
    // « Already said? » of `payroll.remind_documents`, each hour, per document (EQ-06 lot 5c-2, Bilan on #357): read
    // through this index rather than across the whole outbox.
    index('domain_events_document_expiring_idx')
      .on(sql`(${t.payload}->>'documentId')`)
      .where(sql`${t.type} = 'contractor_document_expiring'`),
    // « Already said? » of `payroll.remind_due_invoices`, each morning, per invoice and type (EQ-06 lot 8): the two
    // types of the due date's alert only, read through this index rather than across the whole outbox.
    index('domain_events_invoice_due_idx')
      .on(sql`(${t.payload}->>'invoiceId')`, t.type)
      .where(sql`${t.type} in ('invoice_due_soon', 'invoice_overdue')`),
    // The blocked issues `payroll.requeue_invoice_issues` gives again, all or one contractor's (ARC-08): read through
    // this index rather than across the whole outbox.
    index('domain_events_invoice_not_issued_idx')
      .on(sql`(${t.payload}->>'memberId')`)
      .where(sql`${t.type} = 'invoice_not_issued'`),
    // Once per platform and fortnight (CRM-04 lot b3): the recheck that publishes it may run again, and says nothing new.
    uniqueIndex('domain_events_sales_feed_mismatch_unique')
      .on(sql`(${t.payload}->>'platform')`, sql`(${t.payload}->>'from')`)
      .where(sql`${t.type} = 'sales_feed_mismatch'`),
    tenantPolicy(t.creatorId),
    // `sale_detected` names who sold: her own account never reads the outbox, and still adds to it (CRM-04 lot d).
    hiddenFromCreator(),
  ],
);
