import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  AuditEntryIdSchema,
  EXTENSION_LINKS_LIVE_MAX,
  ExtensionLinkIdSchema,
  newId,
  UserIdSchema,
  UserRoleSchema,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { ExtensionLinkStore, LinkHolder, TrendActor } from '../../domain/ports';

const { auditLog, extensionLinks, teamMembers, user } = schema;

/** A condition on `extension_links`, as the operators build it. */
type Condition = ReturnType<typeof eq>;

/** 256 random bits, base64url: 43 characters (`ExtensionLinkTokenSchema`). */
const TOKEN_BYTES = 32;

/** Only the SHA-256 of a token is stored or compared. */
const hashOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** Constant time, on two hashes of the same length. */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function audit(tx: Transaction, actor: TrendActor, action: string, linkId: string): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: 'extension_link',
    entityId: linkId,
    ip: actor.ip,
    details: {},
  });
}

/** Revokes the actor's live links the condition names, each in the audit log; how many. */
async function revokeLive(tx: Transaction, actor: TrendActor, which: Condition): Promise<number> {
  const revoked = await tx
    .update(extensionLinks)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(extensionLinks.userId, actor.userId), sql`${extensionLinks.revokedAt} is null`, which))
    .returning({ id: extensionLinks.id });
  for (const link of revoked) await audit(tx, actor, 'extension_link.revoke', link.id);
  return revoked.length;
}

/**
 * Who may hold a link, read in the base and never from the session: the owner, a member of the team who has not left,
 * a creator's account linked to one creator. `null` for anyone else (an account gone, a member who left).
 */
async function holderOf(tx: Transaction, userId: string, lock: boolean): Promise<LinkHolder | null> {
  const query = tx
    .select({ role: user.role, creatorIds: user.creatorIds })
    .from(user)
    .where(eq(user.id, userId));
  // The account's row is the lock: two links asked at once are made one after the other.
  const [account] = lock ? await query.for('update') : await query;
  const role = UserRoleSchema.safeParse(account?.role);
  if (!role.success) return null;
  const id = UserIdSchema.parse(userId);
  if (role.data === 'owner') return { userId: id, role: role.data };
  if (role.data === 'creator')
    return account?.creatorIds.length === 1 ? { userId: id, role: role.data } : null;
  const [member] = await tx
    .select({ status: teamMembers.status })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return member === undefined || member.status === 'left' ? null : { userId: id, role: role.data };
}

/** `extension_links` through `withAdmin` (migration 0100): the application role cannot reach it. */
export function createDrizzleExtensionLinkStore(adminDb: Database): ExtensionLinkStore {
  return {
    live: (userId) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            id: extensionLinks.id,
            label: extensionLinks.label,
            createdAt: extensionLinks.createdAt,
            lastUsedAt: extensionLinks.lastUsedAt,
          })
          .from(extensionLinks)
          .where(and(eq(extensionLinks.userId, userId), sql`${extensionLinks.revokedAt} is null`))
          .orderBy(sql`${extensionLinks.createdAt} asc, ${extensionLinks.id} asc`);
        return rows.map((row) => ({
          id: ExtensionLinkIdSchema.parse(row.id),
          label: row.label,
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        }));
      }),

    create: (actor, label) =>
      withAdmin(adminDb, async (tx) => {
        if ((await holderOf(tx, actor.userId, true)) === null) return null;
        // The same browser linked again (its storage lost, the extension reinstalled): its old link goes.
        await revokeLive(tx, actor, eq(extensionLinks.label, label));
        const [live] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(extensionLinks)
          .where(and(eq(extensionLinks.userId, actor.userId), sql`${extensionLinks.revokedAt} is null`));
        if ((live?.count ?? 0) >= EXTENSION_LINKS_LIVE_MAX) return 'full';
        const token = randomBytes(TOKEN_BYTES).toString('base64url');
        const id = newId(ExtensionLinkIdSchema);
        const [created] = await tx
          .insert(extensionLinks)
          .values({ id, userId: actor.userId, tokenHash: hashOf(token), label })
          .returning({ createdAt: extensionLinks.createdAt });
        if (created === undefined) throw new Error('extension link not created');
        await audit(tx, actor, 'extension_link.create', id);
        return { id, label, token, createdAt: created.createdAt.toISOString() };
      }),

    revoke: (actor, linkId) =>
      withAdmin(adminDb, async (tx) => (await revokeLive(tx, actor, eq(extensionLinks.id, linkId))) > 0),

    holder: (token, { touch }) =>
      withAdmin(adminDb, async (tx) => {
        const hash = hashOf(token);
        const [row] = await tx
          .select({
            id: extensionLinks.id,
            tokenHash: extensionLinks.tokenHash,
            userId: extensionLinks.userId,
          })
          .from(extensionLinks)
          .where(and(eq(extensionLinks.tokenHash, hash), sql`${extensionLinks.revokedAt} is null`));
        if (row === undefined || !sameHash(row.tokenHash, hash)) return null;
        // Read again at each batch: a member who left, an account gone, and the link no longer names anyone.
        const holder = await holderOf(tx, row.userId, false);
        if (holder === null) return null;
        if (touch)
          await tx
            .update(extensionLinks)
            .set({ lastUsedAt: sql`now()` })
            .where(eq(extensionLinks.id, row.id));
        return holder;
      }),
  };
}
