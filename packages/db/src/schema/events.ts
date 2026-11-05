import { EVENT_TYPES } from '@impera/contracts';
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
    // Once per medium, type and date (CR-06 c): `content_drops.erase_originals` runs each hour and says each thing
    // once; a medium given again after its erasure gets a new date. Its erasure is said once by the row it marks.
    uniqueIndex('domain_events_content_media_unique')
      .on(sql`(${t.payload}->>'mediaAssetId')`, t.type, sql`(${t.payload}->>'erasedOn')`)
      .where(sql`${t.type} in ('content_media_expiring', 'content_media_erase_failed')`),
    // Once per account, fortnight and currency (CRM-04 lot d3): the job that publishes it may run again.
    uniqueIndex('domain_events_agency_share_mismatch_unique')
      .on(
        sql`(${t.payload}->>'platformAccountId')`,
        sql`(${t.payload}->>'from')`,
        sql`(${t.payload}->>'currency')`,
      )
      .where(sql`${t.type} = 'agency_share_mismatch'`),
    // « Is this service down already? » of `publishConnectionState` (Telegram P3-12): the latest row of one service,
    // read through this index rather than across the whole outbox.
    index('domain_events_connection_state_idx')
      .on(sql`(${t.payload}->>'service')`, t.createdAt)
      .where(sql`${t.type} = 'connection_state_changed'`),
    tenantPolicy(t.creatorId),
    // `sale_detected` names who sold: her own account never reads the outbox, and still adds to it (CRM-04 lot d).
    hiddenFromCreator(),
  ],
);
