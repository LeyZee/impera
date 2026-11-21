import {
  AuditEntryIdSchema,
  LinkPlacementSchema,
  RedirectLinkIdSchema,
  newId,
  type CreatorId,
  type LinkRef,
} from '@impera/contracts';
import {
  and,
  eq,
  onCreatorList,
  schema,
  sql,
  withAdmin,
  withCreatorAccount,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { RedirectLinkError } from '../../domain/errors';
import { sameAddress, writeFault, type StoredRedirectLink } from '../../domain/links';
import type { RedirectLinkActor, RedirectLinkStore, RedirectLinkWrite } from '../../domain/ports';

const { auditLog, creators, redirectLinks } = schema;

const columns = {
  id: redirectLinks.id,
  name: redirectLinks.name,
  url: redirectLinks.url,
  destination: redirectLinks.destination,
  placement: redirectLinks.placement,
  usageNote: redirectLinks.usageNote,
  enabled: redirectLinks.enabled,
  attached: sql<boolean>`${redirectLinks.serviceRef} is not null`,
};

interface LinkRow {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly destination: string;
  readonly placement: string | null;
  readonly usageNote: string;
  readonly enabled: boolean;
  readonly attached: boolean;
}

function toLink(row: LinkRow): StoredRedirectLink {
  return {
    id: RedirectLinkIdSchema.parse(row.id),
    name: row.name,
    url: row.url,
    destination: row.destination,
    placement: row.placement === null ? null : LinkPlacementSchema.parse(row.placement),
    usageNote: row.usageNote,
    enabled: row.enabled,
    attached: row.attached,
  };
}

/** Whether a failed write hit the constraint named: Drizzle wraps the driver's error as `cause`. */
function hitUnique(error: unknown, constraint: string): boolean {
  for (let current = error; typeof current === 'object' && current !== null;) {
    if ('code' in current && current.code === '23505')
      return 'constraint' in current && current.constraint === constraint;
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}

/** Every link of the creator, in the order the screens show them. The policies decide which rows the role reads. */
async function linksOf(tx: Transaction, creatorId: string): Promise<StoredRedirectLink[]> {
  const rows = await tx
    .select(columns)
    .from(redirectLinks)
    .where(eq(redirectLinks.creatorId, creatorId))
    .orderBy(redirectLinks.name);
  return rows.map(toLink);
}

/**
 * The person's right on the creator, read in the base and never from the session: the owner and an active manager,
 * for a creator that exists, a manager for the creators on his list only. A chatter, a creator's account or a member who left is refused.
 */
async function assertAgency<T>(
  db: Database,
  actor: RedirectLinkActor,
  creatorId: CreatorId,
  fn: (tx: Transaction) => Promise<T>,
  /** A write is the owner's alone (ADR 0080 § 6): an address decides where her readers land. */
  ownerOnly = false,
): Promise<T> {
  return withTenantMember(db, creatorId, actor.userId, async (tx, scope) => {
    if (scope !== 'owner' && (ownerOnly || scope !== 'agency')) throw new RedirectLinkError('forbidden');
    // `creators` is the tenant root, without RLS: a creator that does not exist is refused, not a foreign key error.
    const [creator] = await tx.select({ id: creators.id }).from(creators).where(eq(creators.id, creatorId));
    if (creator === undefined) throw new RedirectLinkError('forbidden');
    // An active manager reaches only the creators on his own list (recette 05/11).
    if (scope === 'agency' && !(await onCreatorList(tx, actor.userId, creatorId)))
      throw new RedirectLinkError('forbidden');
    return fn(tx);
  });
}

/** One writer at a time per creator: the count and the names read are still true when the row is written. */
async function lockCreatorLinks(tx: Transaction, creatorId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`redirect_links:${creatorId}`}, 0))`);
}

/** The audit line of a write: which fields were set, never an address nor a sentence. */
async function audit(
  tx: Transaction,
  actor: RedirectLinkActor,
  action: 'redirect_link.create' | 'redirect_link.update' | 'redirect_link.attach',
  link: StoredRedirectLink,
  /** The address changed: said as a fact, the address itself never written here. */
  urlChanged: boolean,
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: actor.userId,
    action,
    entity: 'redirect_link',
    entityId: link.id,
    ip: actor.ip,
    details: {
      placement: link.placement,
      enabled: link.enabled,
      hasUsageNote: link.usageNote !== '',
      urlChanged,
    },
  });
}

/**
 * `redirect_links` through each person's own door. She reads in `withCreatorAccount`, under her policy. The owner and
 * an active manager read in `withTenantMember`. A write is the owner's alone: the right is read first in their own
 * transaction, then the row is written on the service connection, the table having no write policy (INS-03).
 */
export function createDrizzleRedirectLinkStore(db: Database, adminDb: Database): RedirectLinkStore {
  const write = async (
    actor: RedirectLinkActor,
    creatorId: CreatorId,
    id: StoredRedirectLink['id'] | undefined,
    values: RedirectLinkWrite,
  ): Promise<StoredRedirectLink> => {
    await assertAgency(db, actor, creatorId, () => Promise.resolve(), true);
    return withAdmin(adminDb, async (tx) => {
      await lockCreatorLinks(tx, creatorId);
      const before = await linksOf(tx, creatorId);
      const fault = writeFault(
        before,
        id === undefined ? values : { id, name: values.name, url: values.url },
      );
      if (fault !== null) throw new RedirectLinkError(fault);
      const previous = before.find((one) => one.id === id);
      // Another address is another link at the service: what was attached no longer holds, in this same write.
      const detached = previous !== undefined && sameAddress(previous.url) !== sameAddress(values.url);
      const row = { ...values, updatedBy: actor.userId, ...(detached ? { serviceRef: null } : {}) };
      const [saved] =
        id === undefined
          ? await tx
              .insert(redirectLinks)
              .values({ ...row, id: newId(RedirectLinkIdSchema), creatorId })
              .returning(columns)
          : await tx
              .update(redirectLinks)
              .set({ ...row, updatedAt: sql`now()` })
              .where(and(eq(redirectLinks.id, id), eq(redirectLinks.creatorId, creatorId)))
              .returning(columns);
      if (saved === undefined) throw new RedirectLinkError('link_not_found');
      const link = toLink(saved);
      await audit(
        tx,
        actor,
        id === undefined ? 'redirect_link.create' : 'redirect_link.update',
        link,
        previous !== undefined && previous.url !== link.url,
      );
      return link;
    });
  };

  return {
    listForAgency: (actor, creatorId) => assertAgency(db, actor, creatorId, (tx) => linksOf(tx, creatorId)),
    listOwn: (userId) => withCreatorAccount(db, userId, (tx, creatorId) => linksOf(tx, creatorId)),
    enabledUnscoped: (creatorId) =>
      withAdmin(adminDb, async (tx) => {
        const links = await linksOf(tx, creatorId);
        return links.length === 0 ? null : links.filter((link) => link.enabled);
      }),
    create: (actor, creatorId, values) => write(actor, creatorId, undefined, values),
    update: (actor, creatorId, id, values) => write(actor, creatorId, id, values),
    attach: async (actor, creatorId, id, ref: LinkRef) => {
      try {
        // The owner's own door: the policy `owner_attach` and the grant on this one column let it through.
        return await assertAgency(
          db,
          actor,
          creatorId,
          async (tx) => {
            const [saved] = await tx
              .update(redirectLinks)
              .set({ serviceRef: ref, updatedAt: sql`now()` })
              .where(and(eq(redirectLinks.id, id), eq(redirectLinks.creatorId, creatorId)))
              .returning(columns);
            if (saved === undefined) throw new RedirectLinkError('link_not_found');
            const link = toLink(saved);
            await audit(tx, actor, 'redirect_link.attach', link, false);
            return link;
          },
          true,
        );
      } catch (error) {
        if (hitUnique(error, 'redirect_links_service_ref_unique'))
          throw new RedirectLinkError('attached_elsewhere');
        throw error;
      }
    },
  };
}
