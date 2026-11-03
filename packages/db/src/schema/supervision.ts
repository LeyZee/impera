import { KillSwitchScopeSchema } from '@impera/contracts';
import { boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import {
  closedToCreator,
  createdAt,
  enumCheck,
  enumText,
  id,
  tenantOrGlobalPolicy,
  tenantPolicy,
  timestampTz,
} from './columns';
import { creators } from './tenancy';

/** Module `supervision`. Approvals and takeovers are not tables: they are `conversation_events`. */

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestampTz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_unread_idx').on(t.userId, t.readAt),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);

/** A `global` kill switch has no creator and stays visible to every tenant. */
export const killSwitches = pgTable(
  'kill_switches',
  {
    id: id(),
    scope: enumText('scope').notNull(),
    scopeId: uuid('scope_id'),
    creatorId: uuid('creator_id').references(() => creators.id),
    active: boolean('active').notNull(),
    reason: text('reason').notNull(),
    setBy: text('set_by').notNull(),
    setAt: timestampTz('set_at').notNull().defaultNow(),
  },
  (t) => [
    enumCheck('kill_switches', t.scope, KillSwitchScopeSchema.options),
    index('kill_switches_scope_idx').on(t.scope, t.scopeId),
    ...tenantOrGlobalPolicy(t.creatorId),
    closedToCreator(),
  ],
);
