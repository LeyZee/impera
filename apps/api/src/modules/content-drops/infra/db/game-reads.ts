import { calendarDayAt, ContentRequestStateSchema } from '@impera/contracts';
import { and, eq, schema, sql, type Transaction } from '@impera/db';
import type { z } from 'zod';

const { contentDrops, contentRequests, creators, domainEvents } = schema;

/** A request of hers as the creator's game reads it, its days in her zone (ADR 0107 § 2). */
interface RequestForGame {
  readonly dueOn: string;
  readonly state: z.infer<typeof ContentRequestStateSchema>;
  readonly decidedOn: string | null;
  /** The first day a drop she made from it, not withdrawn, arrived (Reçu or beyond); `null` if none has. */
  readonly arrivedOn: string | null;
}

/** What the creator's game reads of her drops and requests (ADR 0107 § 2 and § 3). */
export interface DropsForGame {
  readonly requests: readonly RequestForGame[];
  /** A drop she made arrived, ever, withdrawn afterwards or not. */
  readonly firstDrop: boolean;
  /** A drop she made in the Script category arrived, ever. */
  readonly firstScript: boolean;
}

/**
 * Her drops as the game counts them, in the game's own job or read: the module owns them, the game gets this function
 * through the module's `index.ts`, never the tables. A drop « arrived » when its `content_drop_received` event was
 * written, the moment it reached Reçu; only the drops her own account made count, never one the agency dropped for
 * her. On the admin connection, bounded to her creator; nothing is written.
 */
export async function dropsForGameUnscoped(
  tx: Transaction,
  creatorId: string,
  userId: string,
): Promise<DropsForGame> {
  const [creator] = await tx
    .select({ timeZone: creators.timezone })
    .from(creators)
    .where(eq(creators.id, creatorId));
  if (creator === undefined) throw new Error(`creator ${creatorId} of the game not found`);
  const zone = creator.timeZone;
  const arrivals = await tx
    .select({
      requestId: contentDrops.requestId,
      category: contentDrops.category,
      state: contentDrops.state,
      arrivedAt: domainEvents.createdAt,
    })
    .from(domainEvents)
    .innerJoin(contentDrops, sql`${contentDrops.id}::text = ${domainEvents.payload}->>'dropId'`)
    .where(
      and(
        eq(domainEvents.type, 'content_drop_received'),
        eq(domainEvents.creatorId, creatorId),
        eq(contentDrops.creatorId, creatorId),
        eq(contentDrops.createdBy, userId),
      ),
    );
  const firstArrival = new Map<string, string>();
  for (const arrival of arrivals) {
    if (arrival.requestId === null || arrival.state === 'withdrawn') continue;
    const day = calendarDayAt(arrival.arrivedAt, zone);
    const known = firstArrival.get(arrival.requestId);
    if (known === undefined || day < known) firstArrival.set(arrival.requestId, day);
  }
  const rows = await tx
    .select({
      id: contentRequests.id,
      dueOn: contentRequests.dueOn,
      state: contentRequests.state,
      decidedAt: contentRequests.decidedAt,
    })
    .from(contentRequests)
    .where(eq(contentRequests.creatorId, creatorId))
    .orderBy(contentRequests.dueOn, contentRequests.createdAt);
  return {
    requests: rows.map((row) => ({
      dueOn: row.dueOn,
      state: ContentRequestStateSchema.parse(row.state),
      decidedOn: row.decidedAt === null ? null : calendarDayAt(row.decidedAt, zone),
      arrivedOn: firstArrival.get(row.id) ?? null,
    })),
    firstDrop: arrivals.length > 0,
    firstScript: arrivals.some((arrival) => arrival.category === 'script'),
  };
}
