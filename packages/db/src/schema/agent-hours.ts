import { sql } from 'drizzle-orm';
import { check, date, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { closedToCreator, createdAt, id, tenantPolicy, updatedAt } from './columns';
import { creators } from './tenancy';

/**
 * One date out of her week type (ADR 0148 § 3): that day, on her clock, `ranges` (`DayRange[]`, packages/contracts)
 * replace her reply slots of `creators.agent_hours`; an empty list means no agent that day. One row per creator and
 * date. The agency's setting, like her hours: closed to her own account.
 */
export const agentHourExceptions = pgTable(
  'agent_hour_exceptions',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    ranges: jsonb('ranges').notNull(),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('agent_hour_exceptions_creator_date_unique').on(t.creatorId, t.date),
    index('agent_hour_exceptions_creator_date_idx').on(t.creatorId, t.date),
    check('agent_hour_exceptions_ranges_array_check', sql`jsonb_typeof(${t.ranges}) = 'array'`),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);
