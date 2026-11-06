import {
  ContentIdeaIdSchema,
  ContentIdeaSchema,
  ContentIdeaStateSchema,
  CreatorIdSchema,
  IdeaDropCategorySchema,
  TrendSignalIdSchema,
  TrendSignalSchema,
  type ContentIdea,
  type TrendSignal,
} from '@impera/contracts';
import {
  and,
  eq,
  schema,
  sql,
  withAdmin,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { ContentIdeaDecided, ContentIdeaForbidden, ContentIdeaNotFound } from '../../domain/errors';
import type { IdeaFollowStore, IdeaStore } from '../../domain/ports';

const ideas = schema.contentIdeas;
const signals = schema.trendSignals;

type IdeaRow = typeof ideas.$inferSelect;
type SignalRow = typeof signals.$inferSelect;

function signalOf(row: SignalRow): TrendSignal {
  const figures = row.views === null && row.likes === null && row.comments === null;
  return TrendSignalSchema.parse({
    id: row.id,
    creatorId: row.creatorId,
    source: row.source,
    kind: row.kind,
    text: row.text,
    url: row.url,
    format: row.format,
    metrics: figures ? null : { views: row.views, likes: row.likes, comments: row.comments },
    observedAt: row.observedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  });
}

/** Her day (`YYYY-MM-DD`) at `now`, in her zone. */
function dayIn(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function ideaOf(row: IdeaRow): ContentIdea {
  return ContentIdeaSchema.parse({
    id: ContentIdeaIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    signalId: TrendSignalIdSchema.parse(row.signalId),
    title: row.title,
    category: row.category,
    toShoot: row.toShoot,
    reason: row.reason,
    shootMinutes: row.shootMinutes,
    state: row.state,
    proposedOn: row.proposedOn,
    refusalReason: row.refusalReason,
  });
}

/** Her idea of that id, locked for its decision; RLS (`team_all`) hides another creator's. */
async function lockedIdea(tx: Transaction, ideaId: string): Promise<IdeaRow> {
  const [row] = await tx.select().from(ideas).where(eq(ideas.id, ideaId)).for('update');
  if (row === undefined) throw new ContentIdeaNotFound();
  return row;
}

/**
 * « Idées du jour » through `withTenantMember`: the owner, or a manager while active (`agency`); anyone else is refused
 * before any read, as `content_ideas` RLS would hide every row from them anyway. The same gesture replayed changes
 * nothing; the other gesture on a decided idea is refused.
 */
export function createDrizzleIdeaStore(db: Database): IdeaStore {
  const asAgency = <T>(creatorId: string, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenantMember(db, creatorId, userId, (tx, scope) => {
      if (scope !== 'owner' && scope !== 'agency') throw new ContentIdeaForbidden();
      return fn(tx);
    });

  return {
    ofDay: (creatorId, userId, wanted, now) =>
      asAgency(creatorId, userId, async (tx) => {
        let day = wanted;
        if (day === undefined) {
          const [creator] = await tx
            .select({ timeZone: schema.creators.timezone })
            .from(schema.creators)
            .where(eq(schema.creators.id, creatorId));
          if (creator === undefined) throw new ContentIdeaForbidden();
          day = dayIn(now, creator.timeZone);
        }
        // Her signal, or the agency's: `team_read` lets the owner and a manager read both.
        const rows = await tx
          .select({ idea: ideas, signal: signals })
          .from(ideas)
          .innerJoin(signals, eq(signals.id, ideas.signalId))
          .where(eq(ideas.proposedOn, day))
          .orderBy(ideas.createdAt, ideas.id);
        return { day, items: rows.map((row) => ({ ...ideaOf(row.idea), signal: signalOf(row.signal) })) };
      }),

    validate: (creatorId, userId, ideaId, correction, check, now) =>
      asAgency(creatorId, userId, async (tx) => {
        const row = await lockedIdea(tx, ideaId);
        if (row.state === 'refused') throw new ContentIdeaDecided();
        // Validated before, or already in her agenda: the same gesture again, its correction not read.
        if (row.state !== 'proposed') return ideaOf(row);
        const corrected = ContentIdeaSchema.parse({ ...ideaOf(row), ...correction });
        check(corrected);
        const [updated] = await tx
          .update(ideas)
          .set({
            title: corrected.title,
            category: corrected.category,
            toShoot: corrected.toShoot,
            reason: corrected.reason,
            shootMinutes: corrected.shootMinutes,
            state: 'validated',
            decidedBy: userId,
            decidedAt: now,
            updatedAt: sql`now()`,
          })
          .where(and(eq(ideas.id, row.id), eq(ideas.state, 'proposed')))
          .returning();
        if (updated === undefined) throw new ContentIdeaNotFound();
        return ideaOf(updated);
      }),

    refuse: (creatorId, userId, ideaId, reason, now) =>
      asAgency(creatorId, userId, async (tx) => {
        const row = await lockedIdea(tx, ideaId);
        if (row.state === 'refused') return ideaOf(row);
        if (row.state !== 'proposed') throw new ContentIdeaDecided();
        const [updated] = await tx
          .update(ideas)
          .set({
            state: 'refused',
            refusalReason: reason,
            decidedBy: userId,
            decidedAt: now,
            updatedAt: sql`now()`,
          })
          .where(eq(ideas.id, row.id))
          .returning();
        if (updated === undefined) throw new ContentIdeaNotFound();
        return ideaOf(updated);
      }),

    suggested: (creatorId, userId, ideaId) =>
      asAgency(creatorId, userId, async (tx) => {
        const row = await lockedIdea(tx, ideaId);
        if (row.state !== 'validated') return ideaOf(row);
        const [updated] = await tx
          .update(ideas)
          .set({ state: 'suggested', suggestionId: row.id, updatedAt: sql`now()` })
          .where(eq(ideas.id, row.id))
          .returning();
        if (updated === undefined) throw new ContentIdeaNotFound();
        return ideaOf(updated);
      }),
  };
}

/**
 * The follow-up of an idea her agenda decided (VEI-01 d2) and of its drop (d3), as the owner role: the jobs read under
 * no account.
 */
export function createDrizzleIdeaFollowStore(adminDb: Database): IdeaFollowStore {
  return {
    ofSuggestion: (suggestionId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx.select().from(ideas).where(eq(ideas.suggestionId, suggestionId));
        if (row === undefined) return null;
        return {
          id: row.id,
          creatorId: row.creatorId,
          state: ContentIdeaStateSchema.parse(row.state),
          category: IdeaDropCategorySchema.parse(row.category),
          title: row.title,
          requestId: row.requestId,
        };
      }),
    requested: (ideaId) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .update(ideas)
          .set({ requestId: ideaId, updatedAt: sql`now()` })
          .where(and(eq(ideas.id, ideaId), eq(ideas.state, 'suggested'), sql`${ideas.requestId} is null`));
      }),
    declined: (ideaId) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .update(ideas)
          .set({ state: 'declined', updatedAt: sql`now()` })
          .where(and(eq(ideas.id, ideaId), eq(ideas.state, 'suggested')));
      }),
    deposited: (creatorId, requestId) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .update(ideas)
          .set({ state: 'deposited', updatedAt: sql`now()` })
          .where(
            and(eq(ideas.requestId, requestId), eq(ideas.creatorId, creatorId), eq(ideas.state, 'suggested')),
          );
      }),
  };
}
