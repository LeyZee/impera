import { sql, type SQL } from 'drizzle-orm';
import { check, integer, jsonb, pgPolicy, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { closedToCreator, createdAt } from './columns';
import { creators } from './tenancy';

/*
 * Her grid of custom prices (ADR 0159 § C): one row per save, never changed, the latest version is the grid in force.
 * The owner's alone: he reads it under her RLS with the owner's scope; a manager, a chatter and her own account read
 * nothing. Written by the owner alone, under her RLS too (`owner_insert`), never changed nor deleted. The grid's shape
 * is the contract's (`CustomPriceGridSchema`), parsed on the way in and on the way out.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;

export const customPriceGrids = pgTable(
  'custom_price_grids',
  {
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    grid: jsonb('grid').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'custom_price_grids_pkey', columns: [t.creatorId, t.version] }),
    check('custom_price_grids_version_check', sql`${t.version} >= 1`),
    check('custom_price_grids_grid_check', sql`jsonb_typeof(${t.grid}) = 'object'`),
    closedToCreator(),
    pgPolicy('owner_read', {
      for: 'select',
      using: sql`${currentScope} = 'owner' and ${t.creatorId} = ${currentCreator}`,
    }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${currentScope} = 'owner' and ${t.creatorId} = ${currentCreator}`,
    }),
  ],
);
