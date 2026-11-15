import { MCP_CAPABILITIES, MCP_GRANT_MAX_DAYS } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, id, timestampTz } from './columns';
import { creators } from './tenancy';

const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const isOwner: SQL = sql`nullif(current_setting('app.team_scope', true), '') = 'owner'`;
const capabilities = sql.raw(`array[${MCP_CAPABILITIES.map((c) => `'${c}'`).join(', ')}]::text[]`);

/**
 * An agent access to the MCP server (ADR 0026 § 3, ADR 0105): one person it acts for, one creator at most, closed
 * capabilities, a token kept as its SHA-256 only, an expiry at most 90 days on, a revocation. In lot a the owner alone
 * creates one, in his own name, inside `withMember`: he reads, adds, stamps the last use and revokes; nobody deletes.
 * Out of `withMember`, the service role only reads it, to find the access of a token (`findGrantByTokenHashUnscoped`,
 * ADR 0087). What an access may never change (person, creator, capabilities, token, expiry) is closed by column rights
 * and a trigger (migration 0193): a renewal is a new access.
 */
export const mcpGrants = pgTable(
  'mcp_grants',
  {
    id: id(),
    /** The person the agent acts for; his rights are read again at every call. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    creatorId: uuid('creator_id').references(() => creators.id),
    label: text('label').notNull(),
    capabilities: text('capabilities').array().notNull(),
    /** SHA-256 of the token, base64url. */
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    expiresAt: timestampTz('expires_at').notNull(),
    lastUsedAt: timestampTz('last_used_at'),
    revokedAt: timestampTz('revoked_at'),
    revokedBy: text('revoked_by').references(() => user.id),
  },
  (t) => [
    check('mcp_grants_label_check', sql`char_length(${t.label}) between 1 and 40`),
    check(
      'mcp_grants_capabilities_check',
      sql`${t.capabilities} <@ ${capabilities} and array_position(${t.capabilities}, null) is null`,
    ),
    check('mcp_grants_token_hash_check', sql`${t.tokenHash} ~ '^[A-Za-z0-9_-]{43}$'`),
    check(
      'mcp_grants_expires_check',
      sql`${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '${sql.raw(String(MCP_GRANT_MAX_DAYS))} days'`,
    ),
    check(
      'mcp_grants_revoked_check',
      sql`(${t.revokedAt} is null) = (${t.revokedBy} is null) and (${t.revokedAt} is null or ${t.revokedAt} >= ${t.createdAt})`,
    ),
    index('mcp_grants_user_idx').on(t.userId),
    pgPolicy('owner_read', { for: 'select', using: isOwner }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.userId} = ${currentUser} and ${t.createdBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', { for: 'update', using: isOwner, withCheck: isOwner }),
    pgPolicy('creator_closed', {
      as: 'restrictive',
      for: 'all',
      using: sql`current_setting('app.account_role', true) is distinct from 'creator'`,
    }),
  ],
);
