import { EVENT_TYPES } from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, enumCheck, enumText, id, tenantPolicy } from './columns';
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
    tenantPolicy(t.creatorId),
  ],
);
