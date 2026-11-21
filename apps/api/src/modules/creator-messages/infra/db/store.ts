import {
  CREATOR_MESSAGES_SHOWN,
  CreatorIdSchema,
  ToAgencyMessageKindSchema,
  type ToAgencyMessage,
} from '@impera/contracts';
import {
  and,
  eq,
  onCreatorList,
  schema,
  sql,
  withCreatorAccount,
  withTenantMember,
  type Database,
} from '@impera/db';

import { answerOutcome } from '../../domain/answer';
import { MessageAnsweredConflict, MessageNotFound, MessagesForbidden } from '../../domain/errors';
import type { MessageStore } from '../../domain/ports';

const messages = schema.creatorMessages;

const messageOf = (row: typeof messages.$inferSelect): ToAgencyMessage => ({
  id: row.id,
  creatorId: CreatorIdSchema.parse(row.creatorId),
  kind: ToAgencyMessageKindSchema.parse(row.kind),
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  answer: row.answer,
  answeredAt: row.answeredAt?.toISOString() ?? null,
});

/** Hers in her own account (`withCreatorAccount`); her team's through `withTenantMember`, its scope checked here. */
export function createDrizzleMessageStore(db: Database): MessageStore {
  return {
    mine: (userId) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const rows = await tx
          .select()
          .from(messages)
          .where(eq(messages.creatorId, creatorId))
          .orderBy(sql`${messages.createdAt} desc`)
          .limit(CREATOR_MESSAGES_SHOWN);
        return { messages: rows.map(messageOf) };
      }),

    write: (userId, body) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        // A replay of the same id writes nothing and answers the message as it is.
        await tx
          .insert(messages)
          .values({ id: body.id, creatorId, kind: body.kind, body: body.body, createdBy: userId })
          .onConflictDoNothing({ target: messages.id });
        const [row] = await tx
          .select()
          .from(messages)
          .where(and(eq(messages.id, body.id), eq(messages.creatorId, creatorId)));
        if (row === undefined) throw new MessageNotFound();
        return messageOf(row);
      }),

    waiting: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner' && scope !== 'agency') throw new MessagesForbidden('read');
        // A manager reads only the creators on his own list (avis Sécurité, 21/11).
        if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId)))
          throw new MessagesForbidden('read');
        const [creator] = await tx
          .select({ name: schema.creators.displayName })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        const rows = await tx
          .select()
          .from(messages)
          .where(and(eq(messages.creatorId, creatorId), sql`${messages.answer} is null`))
          .orderBy(messages.createdAt);
        return rows.map((row) => ({ ...messageOf(row), creatorName: creator?.name ?? '—' }));
      }),

    answer: (creatorId, userId, id, answer, now) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner') throw new MessagesForbidden('answer');
        const where = and(eq(messages.id, id), eq(messages.creatorId, creatorId));
        const [row] = await tx.select().from(messages).where(where);
        if (row === undefined) throw new MessageNotFound();
        const outcome = answerOutcome(row.answer, answer);
        if (outcome === 'conflict') throw new MessageAnsweredConflict();
        if (outcome === 'replay') return messageOf(row);
        const [written] = await tx
          .update(messages)
          .set({ answer, answeredBy: userId, answeredAt: now })
          .where(and(where, sql`${messages.answer} is null`))
          .returning();
        // Answered meanwhile by another tab: read it again and judge it as a replay or a conflict.
        if (written === undefined) {
          const [again] = await tx.select().from(messages).where(where);
          if (again === undefined) throw new MessageNotFound();
          if (answerOutcome(again.answer, answer) === 'conflict') throw new MessageAnsweredConflict();
          return messageOf(again);
        }
        return messageOf(written);
      }),
  };
}
