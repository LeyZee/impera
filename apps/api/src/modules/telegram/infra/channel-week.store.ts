import {
  ChannelPlannedPostIdSchema,
  ChannelPlannedPostSchema,
  ChannelPostDraftSchema,
  ChannelReviewSchema,
  newId,
  type ChannelPlannedPost,
  type ChannelPlannedPostId,
  type ChannelPostDraft,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenantJob, type Database, type Transaction } from '@impera/db';

import type { ChannelWeekStore, NewPlannedPost, WeekPostChange } from '../domain/week-ports';

const posts = schema.telegramChannelPosts;
/** The line of a post taken out of `planned` while Telegram is called; it stays if the worker dies in between. */
const CLAIMED = 'Envoi en cours : s’il n’est pas sur le canal, il n’est pas renvoyé.';
type Row = typeof posts.$inferSelect;

/** A row as the domain reads it; a row whose json no longer reads keeps its place with no text (written again). */
function toPost(row: Row): ChannelPlannedPost | null {
  const draft = ChannelPostDraftSchema.safeParse(row.draft);
  const review = ChannelReviewSchema.safeParse(row.review);
  const parsed = ChannelPlannedPostSchema.safeParse({
    id: row.id,
    creatorId: row.creatorId,
    day: row.day,
    window: { from: row.windowFrom, until: row.windowUntil },
    at: row.at.toISOString(),
    role: row.role,
    kind: row.kind,
    theme: row.theme,
    draft: draft.success ? draft.data : null,
    mediaId: row.mediaId,
    why: row.why,
    repost: row.repost,
    state: row.state,
    locked: row.locked,
    review: review.success ? review.data : null,
    replacesId: row.replacesId,
    reason: row.reason,
    sentAt: row.sentAt?.toISOString() ?? null,
  });
  return parsed.success ? parsed.data : null;
}

const read = (rows: readonly Row[]): ChannelPlannedPost[] =>
  rows.map(toPost).filter((post): post is ChannelPlannedPost => post !== null);

/**
 * Her channel's week (ADR 0162), under the app role and in her creator only (`withTenantJob`, job `telegram_channel`):
 * every call names her, every statement is bounded to her, and the table's policy lets nothing else through.
 */
export function createChannelWeekStore(db: Database): ChannelWeekStore {
  const hers = <T>(creatorId: CreatorId, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenantJob(db, creatorId, 'telegram_channel', fn);
  return {
    async plan(creatorId: CreatorId, planned: readonly NewPlannedPost[]) {
      const own = planned.filter((post) => post.creatorId === creatorId);
      if (own.length === 0) return [];
      const rows = await hers(creatorId, (tx) =>
        tx
          .insert(posts)
          .values(
            own.map((post) => ({
              id: newId(ChannelPlannedPostIdSchema),
              creatorId: post.creatorId,
              week: post.week,
              day: post.day,
              planKey: post.planKey,
              windowFrom: post.window.from,
              windowUntil: post.window.until,
              at: post.at,
              role: post.role,
              kind: post.kind,
              theme: post.theme,
              replacesId: post.replacesId,
            })),
          )
          .onConflictDoNothing({ target: [posts.creatorId, posts.planKey] })
          .returning(),
      );
      return read(rows);
    },

    async week(creatorId: CreatorId, week: string) {
      const rows = await hers(creatorId, (tx) =>
        tx
          .select()
          .from(posts)
          .where(and(eq(posts.creatorId, creatorId), eq(posts.week, week)))
          .orderBy(sql`${posts.at} asc`, sql`${posts.createdAt} asc`),
      );
      return read(rows);
    },

    async find(creatorId: CreatorId, id: ChannelPlannedPostId) {
      const [row] = await hers(creatorId, (tx) =>
        tx
          .select()
          .from(posts)
          .where(and(eq(posts.creatorId, creatorId), eq(posts.id, id))),
      );
      return row === undefined ? null : toPost(row);
    },

    async update(creatorId: CreatorId, id: ChannelPlannedPostId, change: WeekPostChange) {
      const set = {
        ...(change.draft === undefined ? {} : { draft: change.draft }),
        ...(change.mediaId === undefined ? {} : { mediaId: change.mediaId }),
        ...(change.why === undefined ? {} : { why: change.why }),
        ...(change.repost === undefined ? {} : { repost: change.repost }),
        ...(change.locked === undefined ? {} : { locked: change.locked }),
        ...(change.review === undefined ? {} : { review: change.review }),
        ...(change.reviewedBy === undefined ? {} : { reviewedBy: change.reviewedBy }),
        ...(change.state === undefined ? {} : { state: change.state }),
        ...(change.reason === undefined ? {} : { reason: change.reason }),
        updatedAt: new Date(),
      };
      const rows = await hers(creatorId, (tx) =>
        tx
          .update(posts)
          .set(set)
          .where(and(eq(posts.creatorId, creatorId), eq(posts.id, id), eq(posts.state, 'planned')))
          .returning({ id: posts.id }),
      );
      return rows.length === 1;
    },

    async due(creatorId: CreatorId, now: Date, limit: number) {
      const rows = await hers(creatorId, (tx) =>
        tx
          .select()
          .from(posts)
          .where(and(eq(posts.creatorId, creatorId), eq(posts.state, 'planned'), sql`${posts.at} <= ${now}`))
          .orderBy(sql`${posts.at} asc`)
          .limit(limit),
      );
      return read(rows);
    },

    async toWrite(creatorId: CreatorId, until: Date, limit: number) {
      const rows = await hers(creatorId, (tx) =>
        tx
          .select()
          .from(posts)
          .where(
            and(
              eq(posts.creatorId, creatorId),
              eq(posts.state, 'planned'),
              sql`${posts.at} <= ${until}`,
              sql`${posts.draft} is null`,
            ),
          )
          .orderBy(sql`${posts.at} asc`)
          .limit(limit),
      );
      return read(rows);
    },

    async claim(
      creatorId: CreatorId,
      id: ChannelPlannedPostId,
      draft: ChannelPostDraft,
      mediaId: string | null,
    ) {
      const rows = await hers(creatorId, (tx) =>
        tx
          .update(posts)
          .set({ state: 'failed', reason: CLAIMED, draft, mediaId, updatedAt: new Date() })
          .where(and(eq(posts.creatorId, creatorId), eq(posts.id, id), eq(posts.state, 'planned')))
          .returning({ id: posts.id }),
      );
      return rows.length === 1;
    },

    async markSent(creatorId: CreatorId, id: ChannelPlannedPostId, telegramMessageId: number, at: Date) {
      await hers(creatorId, (tx) =>
        tx
          .update(posts)
          .set({ state: 'sent', reason: null, telegramMessageId, sentAt: at, updatedAt: at })
          .where(
            and(
              eq(posts.creatorId, creatorId),
              eq(posts.id, id),
              eq(posts.state, 'failed'),
              eq(posts.reason, CLAIMED),
            ),
          ),
      );
    },

    async markFailed(creatorId: CreatorId, id: ChannelPlannedPostId, reason: string) {
      await hers(creatorId, (tx) =>
        tx
          .update(posts)
          .set({ reason, updatedAt: new Date() })
          .where(
            and(
              eq(posts.creatorId, creatorId),
              eq(posts.id, id),
              eq(posts.state, 'failed'),
              eq(posts.reason, CLAIMED),
            ),
          ),
      );
    },

    async lastSent(creatorId: CreatorId, limit: number) {
      const rows = await hers(creatorId, (tx) =>
        tx
          .select()
          .from(posts)
          .where(and(eq(posts.creatorId, creatorId), eq(posts.state, 'sent')))
          .orderBy(sql`${posts.sentAt} desc`)
          .limit(limit),
      );
      return read(rows);
    },
  };
}
