import { CUSTOM_ORDER_STATES } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { closedToCreator, createdAt, enumCheck, enumText, id, tenantPolicy, updatedAt } from './columns';
import { fans } from './fans';
import { creators } from './tenancy';

/*
 * His custom orders (ADR 0159 § A): what the agent understood of his request, turn after turn, before and after her
 * yes. One open order per fan at most (`gathering` or `awaiting_creator`). Written by the agent's turn under her RLS
 * (`withTenant`), never by the service role; her own account reads nothing yet (her yes comes with the next lot). The
 * boxes hold what the brain read, never his message: each detail is short and checked by the contract on the way in.
 */

export const customOrders = pgTable(
  'custom_orders',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    fanId: uuid('fan_id').notNull(),
    state: enumText('state').notNull(),
    format: text('format'),
    supplements: jsonb('supplements')
      .notNull()
      .default(sql`'[]'::jsonb`),
    minutes: integer('minutes'),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
    questionsAsked: integer('questions_asked').notNull().default(0),
    /** The card for her once ready (`custom_order_card_ready`), null before. */
    card: jsonb('card'),
    /** His last message this order took in: the same message read twice changes nothing (idempotence). */
    lastInboundMessageId: text('last_inbound_message_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('custom_orders', t.state, CUSTOM_ORDER_STATES),
    check('custom_orders_questions_asked_check', sql`${t.questionsAsked} >= 0`),
    check('custom_orders_minutes_check', sql`${t.minutes} is null or ${t.minutes} >= 1`),
    check('custom_orders_supplements_check', sql`jsonb_typeof(${t.supplements}) = 'array'`),
    check('custom_orders_details_check', sql`jsonb_typeof(${t.details}) = 'object'`),
    check('custom_orders_card_check', sql`${t.card} is null or jsonb_typeof(${t.card}) = 'object'`),
    uniqueIndex('custom_orders_open_per_fan')
      .on(t.creatorId, t.fanId)
      .where(sql`${t.state} in ('gathering', 'awaiting_creator')`),
    index('custom_orders_fan_message').on(t.creatorId, t.fanId, t.lastInboundMessageId),
    // His creator's own fan, never another's: the RLS checks `creator_id`, this ties the fan to it.
    foreignKey({
      name: 'custom_orders_fan_creator_fk',
      columns: [t.fanId, t.creatorId],
      foreignColumns: [fans.id, fans.creatorId],
    }).onDelete('cascade'),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);
