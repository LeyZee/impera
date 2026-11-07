import { newId, TrendSignalIdSchema } from '@impera/contracts';
import {
  eq,
  schema,
  withCreatorAccount,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { TrendLinkForbidden } from '../../domain/errors';
import type { PastedSignal, SignalStore, TrendActor } from '../../domain/ports';

const { creators, trendSignals } = schema;

/**
 * The pasted link, kept once per creator and address (`trend_signals_link_unique`). No `returning`: the creator has no
 * policy to read a signal back (ADR 0042), so the count of rows written says whether this paste added it.
 */
async function insertLink(
  tx: Transaction,
  actor: TrendActor,
  signal: PastedSignal,
  source: 'agency_link' | 'creator_link',
): Promise<boolean> {
  const result = await tx
    .insert(trendSignals)
    .values({
      id: newId(TrendSignalIdSchema),
      creatorId: signal.creatorId,
      source,
      kind: 'format',
      text: signal.text,
      url: signal.url,
      format: signal.format,
      createdBy: actor.userId,
      observedAt: signal.observedAt,
      expiresAt: signal.expiresAt,
    })
    .onConflictDoNothing();
  return (result.rowCount ?? 0) > 0;
}

/**
 * « Coller un lien » through the person's own door: the creator in `withCreatorAccount`, for herself only; the owner
 * and an active manager in `withTenantMember` for the creator named, who must exist; a chatter is refused.
 */
export function createDrizzleSignalStore(db: Database): SignalStore {
  return {
    pasteLink: (actor, signal) => {
      if (actor.role === 'creator')
        return withCreatorAccount(db, actor.userId, async (tx, creatorId) => {
          if (creatorId !== signal.creatorId) throw new TrendLinkForbidden();
          return insertLink(tx, actor, signal, 'creator_link');
        });
      return withTenantMember(db, signal.creatorId, actor.userId, async (tx, scope) => {
        // `creators` is the tenant root, without RLS: a creator that does not exist is refused, not a foreign key error.
        const [creator] = await tx
          .select({ id: creators.id })
          .from(creators)
          .where(eq(creators.id, signal.creatorId));
        if (creator === undefined) throw new TrendLinkForbidden();
        // The owner and an active manager only: a chatter never takes part in the watch (ADR 0060 § 2, amended 07/11).
        if (scope !== 'owner' && scope !== 'agency') throw new TrendLinkForbidden();
        return insertLink(tx, actor, signal, 'agency_link');
      });
    },
  };
}
