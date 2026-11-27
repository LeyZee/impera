import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  AuditEntryIdSchema,
  EXTENSION_LINK_IDLE_DAYS,
  EXTENSION_LINKS_LIVE_MAX,
  ExtensionLinkIdSchema,
  ExtensionLinkScopeSchema,
  newId,
  TeamMembershipSchema,
  teamScopeFor,
  UserIdSchema,
  UserRoleSchema,
  type ExtensionLinkScope,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { ExtensionLinkStore, LinkHolder, TrendActor } from '../../domain/ports';

const { auditLog, extensionLinks, teamMembers, user } = schema;

/** A condition on `extension_links`, as the operators build it. */
type Condition = ReturnType<typeof eq>;

/** 256 random bits, base64url: 43 characters (`ExtensionLinkTokenSchema`). */
const TOKEN_BYTES = 32;

/** A link still in use: not revoked, and used (or made) within `EXTENSION_LINK_IDLE_DAYS`. */
const isLive = sql`${extensionLinks.revokedAt} is null and coalesce(${extensionLinks.lastUsedAt}, ${extensionLinks.createdAt}) > now() - interval '${sql.raw(String(EXTENSION_LINK_IDLE_DAYS))} days'`;

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

/** Who a link names, before the link itself says what it allows and until when. */
type Person = Omit<LinkHolder, 'scopes' | 'expiresAt'>;

/**
 * What a link made now allows (ADR 0109 § 2 and amendment § 11): writing a field of a fan's card and a note on him,
 * for whoever corrects a card and writes a note in the CRM, the owner and the agency's members (`requireRole('owner',
 * 'operator')`, each write checked again on the fan); a creator never (ADR 0063).
 */
const scopesFor = (person: Person): readonly ExtensionLinkScope[] =>
  person.kind === 'creator' ? [] : ExtensionLinkScopeSchema.options;

/** When a link used (or made) at `lastUse` stops naming anyone. */
const expiryOf = (lastUse: Date): Date => new Date(lastUse.getTime() + EXTENSION_LINK_IDLE_DAYS * 86_400_000);

/**
 * Who may hold a link, read in the base and never from the session: the owner, an active manager, a creator's account
 * linked to one creator, for the watch; an active chatter, for the copilot panel's writes only (ADR 0086 § 8), never the
 * watch (ADR 0060 § 2, amended 07/11). `null` for anyone else: an account gone, a member who left or is away.
 */
async function personOf(tx: Transaction, userId: string, lock: boolean): Promise<Person | null> {
  const query = tx
    .select({ role: user.role, creatorIds: user.creatorIds, name: user.name })
    .from(user)
    .where(eq(user.id, userId));
  // The account's row is the lock: two links asked at once are made one after the other.
  const [account] = lock ? await query.for('update') : await query;
  const role = UserRoleSchema.safeParse(account?.role);
  if (account === undefined || !role.success) return null;
  const id = UserIdSchema.parse(userId);
  const named = { userId: id, role: role.data, displayName: account.name };
  if (role.data === 'owner') return { ...named, watch: true, kind: 'owner' };
  if (role.data === 'creator')
    return account.creatorIds.length === 1 ? { ...named, watch: true, kind: 'creator' } : null;
  const [member] = await tx
    .select({ teamRole: teamMembers.teamRole, status: teamMembers.status })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const membership = TeamMembershipSchema.safeParse(
    member === undefined ? null : { role: member.teamRole, status: member.status },
  );
  const scope = teamScopeFor(
    role.data,
    membership.success ? { teamRole: membership.data.role, status: membership.data.status } : null,
  );
  if (scope === 'agency') return { ...named, watch: true, kind: 'manager' };
  // A chatter at work: his link writes only through the copilot panel, which checks his shift at each write.
  return scope === 'self' && membership.success && membership.data.status === 'active'
    ? { ...named, watch: false, kind: 'chatter' }
    : null;
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
          .where(and(eq(extensionLinks.userId, userId), isLive))
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
        const person = await personOf(tx, actor.userId, true);
        if (person === null) return null;
        // The same browser linked again (its storage lost, the extension reinstalled): its old link goes.
        await revokeLive(tx, actor, eq(extensionLinks.label, label));
        const [live] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(extensionLinks)
          .where(and(eq(extensionLinks.userId, actor.userId), isLive));
        if ((live?.count ?? 0) >= EXTENSION_LINKS_LIVE_MAX) return 'full';
        const token = randomBytes(TOKEN_BYTES).toString('base64url');
        const id = newId(ExtensionLinkIdSchema);
        const [created] = await tx
          .insert(extensionLinks)
          .values({
            id,
            userId: actor.userId,
            tokenHash: hashOf(token),
            label,
            scopes: [...scopesFor(person)],
          })
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
            scopes: extensionLinks.scopes,
            createdAt: extensionLinks.createdAt,
            lastUsedAt: extensionLinks.lastUsedAt,
          })
          .from(extensionLinks)
          .where(and(eq(extensionLinks.tokenHash, hash), isLive));
        if (row === undefined || !sameHash(row.tokenHash, hash)) return null;
        // Read again at each batch: a member who left, an account gone, and the link no longer names anyone.
        const person = await personOf(tx, row.userId, false);
        if (person === null) return null;
        let lastUse = row.lastUsedAt ?? row.createdAt;
        if (touch) {
          const [used] = await tx
            .update(extensionLinks)
            .set({ lastUsedAt: sql`now()` })
            .where(eq(extensionLinks.id, row.id))
            .returning({ lastUsedAt: extensionLinks.lastUsedAt });
          lastUse = used?.lastUsedAt ?? lastUse;
        }
        // A scope the code no longer knows is dropped, never read as another (the column's check keeps them closed).
        const scopes = row.scopes.flatMap((scope) => {
          const known = ExtensionLinkScopeSchema.safeParse(scope);
          return known.success ? [known.data] : [];
        });
        return { ...person, scopes, expiresAt: expiryOf(lastUse) };
      }),
  };
}
