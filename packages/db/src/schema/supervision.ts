import { KillSwitchScopeSchema } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import {
  closedToCreator,
  createdAt,
  enumCheck,
  enumText,
  id,
  tenantOrGlobalPolicy,
  tenantPolicy,
  timestampTz,
  updatedAt,
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
    /**
     * A pause (ADR 0148 § 1): the switch is on until this instant, then reads as off without a new row. `null` for a
     * switch lifted by hand. Every reader takes `active and (active_until is null or active_until > now())`.
     */
    activeUntil: timestampTz('active_until'),
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

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;

/**
 * A creator's revenue objective for a month (ADR 0092 § 6): set by the owner alone, read by the owner and the active
 * managers on the agency's Dashboard, never by her account. The agency's objective is the sum of its creators'. In euro
 * cents, VAT included, as the Dashboard's revenue. Unrelated to pay's collective goal.
 */
export const creatorRevenueObjectives = pgTable(
  'creator_revenue_objectives',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** The month's first day. */
    month: date('month').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    /** Who set the amount last: a second write replaces the author with the amount (each write is in `audit_log`). */
    setBy: text('set_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('creator_revenue_objectives_month_unique').on(t.creatorId, t.month),
    check('creator_revenue_objectives_month_check', sql`extract(day from ${t.month}) = 1`),
    // Never zero, and a typing slip never past the contract's bound (AGENCY_OBJECTIVE_MAX_MINOR) skews a projection.
    check('creator_revenue_objectives_amount_check', sql`${t.amountMinor} between 1 and 100000000`),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${currentScope} in ('owner', 'agency')`,
    }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner' and ${t.setBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner'`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner' and ${t.setBy} = ${currentUser}`,
    }),
    pgPolicy('owner_delete', {
      for: 'delete',
      using: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner'`,
    }),
    closedToCreator(),
  ],
);
