import {
  EventIdSchema,
  FanFlagsSchema,
  newId,
  type CreatorId,
  type EventPayload,
  type FanFlags,
  type FanId,
  type TeamScope,
} from '@nirvana/contracts';
import { and, eq, schema, withTenant, withTenantMember, type Database, type Transaction } from '@nirvana/db';

import { FanNotFound } from '../domain/errors';
import type { FlagStore } from '../domain/fan';
import type { FlagAuthor } from '../domain/flags';

async function readFlags(
  tx: Transaction,
  creatorId: CreatorId,
  fanId: FanId,
  forUpdate: boolean,
): Promise<FanFlags> {
  const query = tx
    .select({ flags: schema.fans.flags })
    .from(schema.fans)
    .where(and(eq(schema.fans.id, fanId), eq(schema.fans.creatorId, creatorId)));
  const [row] = forUpdate ? await query.for('update') : await query;
  if (row === undefined) throw new FanNotFound();
  // Written by this module only, through the contract: read back through it too (a column is a boundary).
  return FanFlagsSchema.parse(row.flags);
}

/** The account behind `human:<userId>`, or `null` for the policy. An unknown account reads as `self` (fail-closed). */
const personOf = (author: FlagAuthor): string | null =>
  author === 'system' ? null : author.slice('human:'.length);

export function createDrizzleFlagStore(db: Database): FlagStore {
  /** In the creator, and as the person when there is one: the scope is the database's (fail-closed `self`). */
  const inScope = <T>(
    creatorId: CreatorId,
    person: string | null,
    fn: (tx: Transaction, scope: TeamScope | null) => Promise<T>,
  ): Promise<T> =>
    person === null
      ? withTenant(db, creatorId, (tx) => fn(tx, null))
      : withTenantMember(db, creatorId, person, (tx, scope) => fn(tx, scope));

  return {
    read: (creatorId, fanId) => withTenant(db, creatorId, (tx) => readFlags(tx, creatorId, fanId, false)),
    readAs: (creatorId, fanId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => ({
        flags: await readFlags(tx, creatorId, fanId, false),
        scope,
      })),
    change: (creatorId, fanId, change, event) =>
      inScope(creatorId, personOf(event.author), async (tx, scope) => {
        const before = await readFlags(tx, creatorId, fanId, true);
        const after = change(before, scope);
        if (after === null) return { flags: before, scope };
        await tx.update(schema.fans).set({ flags: after }).where(eq(schema.fans.id, fanId));
        const payload: EventPayload<'fan_flag_set'> = {
          fanId,
          flag: event.flag,
          flags: after,
          ...(event.reason !== undefined && { reason: event.reason }),
        };
        await tx.insert(schema.domainEvents).values({
          id: newId(EventIdSchema),
          creatorId,
          type: event.type,
          payload,
          actor: event.author,
          correlationId: event.correlationId,
        });
        return { flags: after, scope };
      }),
  };
}
