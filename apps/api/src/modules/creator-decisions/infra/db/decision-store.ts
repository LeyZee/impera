import {
  AuditEntryIdSchema,
  CreatorDecisionIdSchema,
  CreatorDecisionKindSchema,
  CreatorIdSchema,
  CreatorTaskCategorySchema,
  DecisionAnswerSchema,
  DecisionLayoutSchema,
  DecisionStateSchema,
  fittingAnswers,
  NewCreatorDecisionSchema,
  newId,
  type CreatorDecisionId,
} from '@impera/contracts';
import {
  and,
  eq,
  schema,
  sql,
  withCreatorAccount,
  withTenantJob,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import { answerOf, asideUntil, shown, toRead, waits, type StoredDecision } from '../../domain/decisions';
import {
  DecisionAnswered,
  DecisionAnswerUnknown,
  DecisionForbidden,
  DecisionNoMoreIdeas,
  DecisionNotFound,
} from '../../domain/errors';
import {
  IDEAS_WRITING_MS,
  type AskedDecision,
  type DecisionAsking,
  type DecisionStore,
} from '../../domain/ports';

const d = schema.creatorDecisions;

const columns = {
  id: d.id,
  kind: d.kind,
  category: d.category,
  question: d.question,
  context: d.context,
  layout: d.layout,
  answers: d.answers,
  otherIdeasLeft: d.otherIdeasLeft,
  state: d.state,
  answerKey: d.answerKey,
  laterUntil: d.laterUntil,
  expiresAt: d.expiresAt,
};

const AnswersSchema = z.array(DecisionAnswerSchema);

interface DecisionRow {
  readonly id: string;
  readonly kind: string;
  readonly category: string;
  readonly question: string;
  readonly context: string;
  readonly layout: string;
  readonly answers: unknown;
  readonly otherIdeasLeft: number;
  readonly state: string;
  readonly answerKey: string | null;
  readonly laterUntil: Date | null;
  readonly expiresAt: Date;
}

function toDecision(row: DecisionRow): StoredDecision {
  return {
    id: CreatorDecisionIdSchema.parse(row.id),
    kind: CreatorDecisionKindSchema.parse(row.kind),
    category: CreatorTaskCategorySchema.parse(row.category),
    question: row.question,
    context: row.context,
    layout: DecisionLayoutSchema.parse(row.layout),
    answers: AnswersSchema.parse(row.answers),
    otherIdeasLeft: row.otherIdeasLeft,
    state: DecisionStateSchema.parse(row.state),
    answerKey: row.answerKey,
    laterUntil: row.laterUntil,
    expiresAt: row.expiresAt,
  };
}

/** The decisions of the creator at hand that the policies show, still open. */
async function openOf(tx: Transaction, creatorId: string): Promise<StoredDecision[]> {
  const rows = await tx
    .select(columns)
    .from(d)
    .where(and(eq(d.creatorId, creatorId), eq(d.state, 'open')));
  return rows.map(toDecision);
}

async function one(tx: Transaction, creatorId: string, id: CreatorDecisionId): Promise<StoredDecision> {
  const [row] = await tx
    .select(columns)
    .from(d)
    .where(and(eq(d.id, id), eq(d.creatorId, creatorId)));
  if (row === undefined) throw new DecisionNotFound();
  return toDecision(row);
}

/**
 * Writes an answer, once: the update names the open row, so that two answers at once keep the first. The same answer
 * again reads back what was noted; another one is refused; a question that ended or was withdrawn is not found.
 */
async function answer(
  tx: Transaction,
  creatorId: string,
  id: CreatorDecisionId,
  key: string,
  userId: string,
  now: Date,
): Promise<{ noted: string; written: boolean }> {
  const decision = await one(tx, creatorId, id);
  const chosen = answerOf(decision, key);
  if (decision.state === 'answered') {
    if (decision.answerKey !== key || chosen === null) throw new DecisionAnswered();
    return { noted: chosen.noted, written: false };
  }
  if (!waits(decision, now)) throw new DecisionNotFound();
  if (chosen === null) throw new DecisionAnswerUnknown();
  const written = await tx
    .update(d)
    .set({ state: 'answered', answerKey: key, answeredAt: now, answeredBy: userId, updatedAt: sql`now()` })
    .where(and(eq(d.id, id), eq(d.creatorId, creatorId), eq(d.state, 'open')))
    .returning({ id: d.id });
  // Answered in between by the other one who may: the first answer stands.
  if (written.length === 0) throw new DecisionAnswered();
  return { noted: chosen.noted, written: true };
}

/** Her decisions through each person's own door: her account, or the owner in the creator at hand. */
export function createDrizzleDecisionStore(db: Database): DecisionStore {
  const asOwner = <T>(
    actor: { readonly userId: string },
    creatorId: string,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTenantMember(db, creatorId, actor.userId, (tx, scope) => {
      if (scope !== 'owner') throw new DecisionForbidden();
      return fn(tx);
    });

  return {
    open: (userId, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) =>
        shown(await openOf(tx, creatorId), now, false).map(toRead),
      ),

    renewable: (userId, id, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const [row] = await tx
          .select({ ...columns, subject: d.subject })
          .from(d)
          .where(and(eq(d.id, id), eq(d.creatorId, creatorId)));
        if (row === undefined) throw new DecisionNotFound();
        const decision = toDecision(row);
        if (!waits(decision, now)) throw new DecisionNotFound();
        if (decision.otherIdeasLeft === 0) throw new DecisionNoMoreIdeas();
        return {
          creatorId: CreatorIdSchema.parse(creatorId),
          subject: row.subject,
          decision: toRead(decision),
        };
      }),

    answer: (userId, id, key, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const { noted } = await answer(tx, creatorId, id, key, userId, now);
        return noted;
      }),

    later: (userId, id, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const decision = await one(tx, creatorId, id);
        if (!waits(decision, now)) throw new DecisionNotFound();
        await tx
          .update(d)
          .set({ laterUntil: asideUntil(now, decision.expiresAt), updatedAt: sql`now()` })
          .where(and(eq(d.id, id), eq(d.creatorId, creatorId), eq(d.state, 'open')));
      }),

    openFor: (actor, creatorId, now) =>
      asOwner(actor, creatorId, async (tx) => shown(await openOf(tx, creatorId), now, true).map(toRead)),

    answerFor: (actor, creatorId, id, key, now) =>
      asOwner(actor, creatorId, async (tx) => {
        const { noted, written } = await answer(tx, creatorId, id, key, actor.userId, now);
        // The owner spoke in her place: said in the audit log, the answer itself never written there.
        if (written)
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId: actor.userId,
            action: 'creator_decision.answer_for',
            entity: 'creator_decision',
            entityId: id,
            ip: actor.ip,
            details: { creatorId },
          });
        return noted;
      }),
  };
}

/** The door of the code that asks (`withTenantJob(…, 'creator_decisions', …)`): one creator at a time. */
export function createDrizzleDecisionAsking(db: Database): DecisionAsking {
  const asking = <T>(creatorId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenantJob(db, creatorId, 'creator_decisions', fn);
  return {
    ask: async (creatorId, decision) => {
      const values = NewCreatorDecisionSchema.parse(decision);
      return asking(creatorId, async (tx) => {
        const written = await tx
          .insert(d)
          .values({
            id: newId(CreatorDecisionIdSchema),
            creatorId,
            kind: values.kind,
            subject: values.subject,
            category: values.category,
            question: values.question,
            context: values.context,
            layout: values.layout,
            answers: values.answers,
            otherIdeasLeft: values.otherIdeasLeft,
            expiresAt: new Date(values.expiresAt),
          })
          .onConflictDoNothing({ target: [d.creatorId, d.kind, d.subject] })
          .returning({ id: d.id });
        return written.length > 0;
      });
    },

    withdraw: (creatorId, kind, subject) =>
      asking(creatorId, async (tx) => {
        await tx
          .update(d)
          .set({ state: 'withdrawn', updatedAt: sql`now()` })
          .where(
            and(eq(d.creatorId, creatorId), eq(d.kind, kind), eq(d.subject, subject), eq(d.state, 'open')),
          );
      }),

    countIdeas: (creatorId, id, now) =>
      asking(creatorId, async (tx) => {
        // The update names the open row with a request left and none being written: two at once keep the first.
        const counted = await tx
          .update(d)
          .set({ otherIdeasLeft: sql`${d.otherIdeasLeft} - 1`, ideasAskedAt: now, updatedAt: sql`now()` })
          .where(
            and(
              eq(d.id, id),
              eq(d.creatorId, creatorId),
              eq(d.state, 'open'),
              sql`${d.otherIdeasLeft} > 0`,
              sql`(${d.ideasAskedAt} is null or ${d.ideasAskedAt} < ${new Date(now.getTime() - IDEAS_WRITING_MS)})`,
            ),
          )
          .returning({ id: d.id });
        return counted.length > 0;
      }),

    returnIdeas: (creatorId, id) =>
      asking(creatorId, async (tx) => {
        await tx
          .update(d)
          .set({ otherIdeasLeft: sql`${d.otherIdeasLeft} + 1`, ideasAskedAt: null, updatedAt: sql`now()` })
          .where(
            and(
              eq(d.id, id),
              eq(d.creatorId, creatorId),
              eq(d.state, 'open'),
              sql`${d.ideasAskedAt} is not null`,
            ),
          );
      }),

    otherIdeas: (creatorId, id, answers) =>
      asking(creatorId, async (tx) => {
        const [open] = await tx
          .select({ layout: d.layout })
          .from(d)
          .where(and(eq(d.id, id), eq(d.creatorId, creatorId), eq(d.state, 'open')));
        if (open === undefined) return null;
        const fitting = fittingAnswers(DecisionLayoutSchema.parse(open.layout), answers);
        const [row] = await tx
          .update(d)
          .set({ answers: fitting, ideasAskedAt: null, updatedAt: sql`now()` })
          .where(
            and(
              eq(d.id, id),
              eq(d.creatorId, creatorId),
              eq(d.state, 'open'),
              sql`${d.ideasAskedAt} is not null`,
            ),
          )
          .returning(columns);
        return row === undefined ? null : toRead(toDecision(row));
      }),

    phones: (creatorId) =>
      asking(creatorId, async (tx) => {
        const [creator] = await tx
          .select({ timeZone: schema.creators.timezone })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        // Her accounts: role `creator`, linked to her alone (one link per account since CR-02).
        const accounts = await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.role, 'creator'),
              sql`${schema.user.creatorIds} = array[${creatorId}]::uuid[]`,
            ),
          )
          .orderBy(schema.user.id);
        return { accounts: accounts.map((one) => one.id), timeZone: creator?.timeZone ?? 'Europe/Paris' };
      }),

    read: (creatorId, kind, subject, now) =>
      asking(creatorId, async (tx): Promise<AskedDecision | null> => {
        const [row] = await tx
          .select({ state: d.state, answerKey: d.answerKey, expiresAt: d.expiresAt })
          .from(d)
          .where(and(eq(d.creatorId, creatorId), eq(d.kind, kind), eq(d.subject, subject)));
        if (row === undefined) return null;
        const state = DecisionStateSchema.parse(row.state);
        return {
          state: state === 'open' && row.expiresAt.getTime() <= now.getTime() ? 'ended' : state,
          answerKey: row.answerKey,
        };
      }),
  };
}
