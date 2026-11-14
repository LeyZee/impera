import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  McpCapabilitySchema,
  McpGrantIdSchema,
  newId,
  UserIdSchema,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@impera/db';

import type { GrantRecord, McpGrantStore, McpOwner } from '../../domain/ports';

const { auditLog, mcpGrants } = schema;

const columns = {
  id: mcpGrants.id,
  userId: mcpGrants.userId,
  creatorId: mcpGrants.creatorId,
  label: mcpGrants.label,
  capabilities: mcpGrants.capabilities,
  createdAt: mcpGrants.createdAt,
  expiresAt: mcpGrants.expiresAt,
  lastUsedAt: mcpGrants.lastUsedAt,
  revokedAt: mcpGrants.revokedAt,
};

type Row = Pick<typeof mcpGrants.$inferSelect, keyof typeof columns>;

function recordOf(row: Row): GrantRecord {
  return {
    id: McpGrantIdSchema.parse(row.id),
    userId: UserIdSchema.parse(row.userId),
    creatorId: row.creatorId === null ? null : CreatorIdSchema.parse(row.creatorId),
    label: row.label,
    capabilities: row.capabilities.map((capability) => McpCapabilitySchema.parse(capability)),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/** Who did what to an access: never its token, its fingerprint or its label. */
async function audit(tx: Transaction, owner: McpOwner, action: string, grantId: string): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: owner.userId,
    action,
    entity: 'mcp_grant',
    entityId: grantId,
    ip: owner.ip,
    details: {},
  });
}

/**
 * `mcp_grants` (migration 0193): the owner's gestures inside `withMember`, his policies deciding; the token's access by
 * the service role, read only (ADR 0087).
 */
export function createDrizzleGrantStore(db: Database, serviceDb: Database): McpGrantStore {
  return {
    list: (owner) =>
      withMember(db, owner.userId, async (tx) =>
        (
          await tx
            .select(columns)
            .from(mcpGrants)
            .orderBy(sql`${mcpGrants.createdAt} desc, ${mcpGrants.id} desc`)
        ).map(recordOf),
      ),

    create: (owner, grant) =>
      withMember(db, owner.userId, async (tx) => {
        const [row] = await tx
          .insert(mcpGrants)
          .values({
            id: grant.id,
            userId: owner.userId,
            creatorId: grant.creatorId,
            label: grant.label,
            capabilities: [...grant.capabilities],
            tokenHash: grant.tokenHash,
            createdBy: owner.userId,
            expiresAt: grant.expiresAt,
          })
          .returning(columns);
        if (row === undefined) throw new Error('mcp grant not created');
        await audit(tx, owner, 'mcp_grant.create', grant.id);
        return recordOf(row);
      }),

    revoke: (owner, id) =>
      withMember(db, owner.userId, async (tx) => {
        const revoked = await tx
          .update(mcpGrants)
          .set({ revokedAt: sql`now()`, revokedBy: owner.userId })
          .where(and(eq(mcpGrants.id, id), sql`${mcpGrants.revokedAt} is null`))
          .returning({ id: mcpGrants.id });
        if (revoked.length === 0) return false;
        await audit(tx, owner, 'mcp_grant.revoke', id);
        return true;
      }),

    findByTokenHashUnscoped: (tokenHash) =>
      withAdmin(serviceDb, async (tx) => {
        const [row] = await tx
          .select(columns)
          .from(mcpGrants)
          .where(
            and(
              eq(mcpGrants.tokenHash, tokenHash),
              sql`${mcpGrants.revokedAt} is null and ${mcpGrants.expiresAt} > now()`,
            ),
          );
        return row === undefined ? null : recordOf(row);
      }),

    touch: (userId, id) =>
      withMember(db, userId, async (tx) => {
        await tx
          .update(mcpGrants)
          .set({ lastUsedAt: sql`greatest(coalesce(${mcpGrants.lastUsedAt}, now()), now())` })
          .where(eq(mcpGrants.id, id));
      }),
  };
}
