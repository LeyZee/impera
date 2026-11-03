import { CreatorIdSchema, newId, TrendReadingIdSchema, type TrendReadingsBatch } from '@impera/contracts';
import { schema, sql, withCreatorAccount, withMember, type Database, type Transaction } from '@impera/db';

import { TrendReadingForbidden } from '../../domain/errors';
import type { LinkHolder, MarkableCreator, ReadingStore } from '../../domain/ports';

const { creators, trendReadings } = schema;

/**
 * One row per person, watch session and post code (`trend_readings_session_post_unique`): a post seen again, by `/p/`
 * or `/reel/`, takes its latest figures and texts, the longest time on screen, the earliest first sight, and keeps a
 * mark once given. The batch is written under the person who watched (`recorder_all`).
 */
async function upsert(tx: Transaction, holder: LinkHolder, batch: TrendReadingsBatch): Promise<number> {
  // One post twice in a batch would be one row written twice in one statement: the last reading of it wins.
  const byCode = new Map(batch.readings.map((reading) => [reading.code, reading]));
  const firstSeen = new Map<string, string>();
  for (const reading of batch.readings) {
    const known = firstSeen.get(reading.code);
    if (known === undefined || reading.seenAt < known) firstSeen.set(reading.code, reading.seenAt);
  }
  const rows = [...byCode.values()].map((reading) => ({
    id: newId(TrendReadingIdSchema),
    recordedBy: holder.userId,
    watchSessionId: batch.watchSession,
    postCode: reading.code,
    path: reading.path,
    account: reading.account,
    views: reading.metrics.views,
    likes: reading.metrics.likes,
    comments: reading.metrics.comments,
    caption: reading.caption,
    hashtags: reading.hashtags,
    sound: reading.sound,
    soundId: reading.soundId,
    dwellMs: reading.dwellMs,
    markedFor: reading.markedFor,
    firstSeenAt: new Date(firstSeen.get(reading.code) ?? reading.seenAt),
    seenAt: new Date(reading.seenAt),
  }));
  const t = trendReadings;
  const excluded = (column: string) => sql.raw(`excluded."${column}"`);
  const result = await tx
    .insert(t)
    .values(rows)
    .onConflictDoUpdate({
      target: [t.recordedBy, t.watchSessionId, t.postCode],
      set: {
        account: sql`coalesce(${excluded('account')}, ${t.account})`,
        views: sql`coalesce(${excluded('views')}, ${t.views})`,
        likes: sql`coalesce(${excluded('likes')}, ${t.likes})`,
        comments: sql`coalesce(${excluded('comments')}, ${t.comments})`,
        caption: sql`coalesce(${excluded('caption')}, ${t.caption})`,
        hashtags: excluded('hashtags'),
        sound: sql`coalesce(${excluded('sound')}, ${t.sound})`,
        soundId: sql`coalesce(${excluded('sound_id')}, ${t.soundId})`,
        dwellMs: sql`greatest(${excluded('dwell_ms')}, ${t.dwellMs})`,
        markedFor: sql`coalesce(${excluded('marked_for_creator_id')}, ${t.markedFor})`,
        firstSeenAt: sql`least(${excluded('first_seen_at')}, ${t.firstSeenAt})`,
        seenAt: sql`greatest(${excluded('seen_at')}, ${t.seenAt})`,
        updatedAt: sql`now()`,
      },
    });
  return result.rowCount ?? 0;
}

const marksOf = (batch: TrendReadingsBatch): string[] => [
  ...new Set(batch.readings.flatMap((reading) => (reading.markedFor === null ? [] : [reading.markedFor]))),
];

/**
 * The readings of the extension: a creator's account in `withCreatorAccount`, who marks a post for herself only; the
 * owner and a member in `withMember`, who mark one for a creator that exists. A batch with one refused mark is refused
 * whole, before anything is written, with the marks refused.
 */
export function createDrizzleReadingStore(db: Database): ReadingStore {
  const markable = (tx: Transaction): Promise<MarkableCreator[]> =>
    tx
      .select({ id: creators.id, displayName: creators.displayName })
      .from(creators)
      .orderBy(creators.displayName)
      .then((rows) =>
        rows.map((row) => ({ id: CreatorIdSchema.parse(row.id), displayName: row.displayName })),
      );
  return {
    markable: (holder) =>
      holder.role === 'creator'
        ? withCreatorAccount(db, holder.userId, async (tx, creatorId) =>
            (await markable(tx)).filter((creator) => creator.id === creatorId),
          )
        : withMember(db, holder.userId, (tx) => markable(tx)),

    record: (holder, batch) => {
      const marks = marksOf(batch);
      const refuseOutside = (allowed: ReadonlySet<string>) => {
        const refused = marks.filter((mark) => !allowed.has(mark));
        if (refused.length > 0) throw new TrendReadingForbidden(refused);
      };
      if (holder.role === 'creator')
        return withCreatorAccount(db, holder.userId, (tx, creatorId) => {
          refuseOutside(new Set([creatorId]));
          return upsert(tx, holder, batch);
        });
      return withMember(db, holder.userId, async (tx) => {
        if (marks.length > 0) refuseOutside(new Set((await markable(tx)).map((creator) => creator.id)));
        return upsert(tx, holder, batch);
      });
    },
  };
}
