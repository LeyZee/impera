import {
  ContentIdeaIdSchema,
  ContentIdeaSchema,
  CreatorIdSchema,
  TrendSignalIdSchema,
  type ContentIdea,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenantMember, type Database, type Transaction } from '@impera/db';

import { ContentIdeaDecided, ContentIdeaForbidden, ContentIdeaNotFound } from '../../domain/errors';
import type { IdeaStore } from '../../domain/ports';

const ideas = schema.contentIdeas;

type IdeaRow = typeof ideas.$inferSelect;

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
    ofDay: (creatorId, userId, day) =>
      asAgency(creatorId, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(ideas)
          .where(eq(ideas.proposedOn, day))
          .orderBy(ideas.createdAt, ideas.id);
        return rows.map(ideaOf);
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
