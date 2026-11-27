import {
  newId,
  ScriptRunIdSchema,
  ScriptRunStatusSchema,
  ScriptRunStepsSchema,
  type ScriptRunStep,
} from '@impera/contracts';
import {
  and,
  eq,
  onCreatorList,
  schema,
  sql,
  withTenantMember,
  type Database,
  type Transaction as DbTransaction,
} from '@impera/db';

import type { ScriptRunState, StoredScriptRun, Transaction } from '../../domain/ports';

const { scriptRuns } = schema;

type Row = typeof scriptRuns.$inferSelect;

function toStored(row: Row): StoredScriptRun {
  // The steps are read back through their schema: a row another hand wrote wrong fails here, never further on.
  const steps = ScriptRunStepsSchema.parse(row.steps).map((step) => ({
    ...step,
    sentAt: new Date(step.sentAt),
    at: new Date(step.at),
  }));
  return {
    id: ScriptRunIdSchema.parse(row.id),
    run: {
      scriptRef: row.scriptRef,
      status: ScriptRunStatusSchema.parse(row.status),
      steps,
      ignoredMessages: row.ignoredMessages,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    },
  };
}

function toStoredSteps(run: ScriptRunState): ScriptRunStep[] {
  return ScriptRunStepsSchema.parse(
    run.steps.map((step) => ({ ...step, sentAt: step.sentAt.toISOString(), at: step.at.toISOString() })),
  );
}

/**
 * `script_runs` in the turn's tenant transaction (ADR 0098): its decision state only, never a history of what was
 * sent, which is Reveal's (ADR 0018 § 5). A run is never deleted.
 */
export function bindScriptRuns(tx: DbTransaction, creatorId: string): Transaction['scriptRuns'] {
  return {
    async latest(conversationId) {
      const [row] = await tx
        .select()
        .from(scriptRuns)
        .where(eq(scriptRuns.conversationId, conversationId))
        .orderBy(sql`${scriptRuns.startedAt} desc`, sql`${scriptRuns.id} desc`)
        .limit(1);
      return row === undefined ? null : toStored(row);
    },
    async stalled(conversationId) {
      const rows = await tx
        .select()
        .from(scriptRuns)
        .where(and(eq(scriptRuns.conversationId, conversationId), eq(scriptRuns.status, 'stalled')))
        .orderBy(sql`${scriptRuns.startedAt} desc`, sql`${scriptRuns.id} desc`)
        // Whether he left one before is all that is read: the latest few say it.
        .limit(20);
      return rows.map(toStored);
    },
    async unbought(conversationId) {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(scriptRuns)
        .where(
          and(
            eq(scriptRuns.conversationId, conversationId),
            sql`${scriptRuns.status} <> 'open'`,
            sql`not exists (select 1 from jsonb_array_elements(${scriptRuns.steps}) as step where step ->> 'outcome' = 'bought')`,
          ),
        );
      return row?.count ?? 0;
    },
    async open(conversationId, run) {
      // One open run per conversation: a second answers « no » by opening nothing.
      const [row] = await tx
        .insert(scriptRuns)
        .values({
          id: newId(ScriptRunIdSchema),
          creatorId,
          conversationId,
          scriptRef: run.scriptRef,
          status: run.status,
          steps: toStoredSteps(run),
          ignoredMessages: run.ignoredMessages,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
        })
        .onConflictDoNothing()
        .returning();
      return row === undefined ? null : toStored(row);
    },
    async save(stored) {
      // Only an open run changes: once ended, it is history.
      const updated = await tx
        .update(scriptRuns)
        .set({
          status: stored.run.status,
          steps: toStoredSteps(stored.run),
          ignoredMessages: stored.run.ignoredMessages,
          endedAt: stored.run.endedAt,
          updatedAt: sql`now()`,
        })
        .where(and(eq(scriptRuns.id, stored.id), eq(scriptRuns.status, 'open')))
        .returning({ id: scriptRuns.id });
      return updated.length === 1;
    },
  };
}

/** A run as the measure of a script reads it (ADR 0129, sous-lot 4c): which script, when, and its steps. */
export interface MeasuredScriptRun {
  readonly scriptRef: string;
  readonly startedAt: Date;
  readonly steps: readonly ScriptRunStep[];
}

/**
 * Her runs started from `since`, as a person of the agency reads them (ADR 0129 § 17): the owner, or an active manager
 * of her list, in his transaction and under her RLS; the oldest first. `null` for anyone else. Read only: what the
 * performance of her scripts counts, handed to the scripts module by the composition root.
 */
export function scriptRunsForTeam(
  db: Database,
  creatorId: string,
  userId: string,
  since: Date,
): Promise<readonly MeasuredScriptRun[] | null> {
  return withTenantMember(db, creatorId, userId, async (tx, scope) => {
    if (scope !== 'owner' && scope !== 'agency') return null;
    if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId))) return null;
    const rows = await tx
      .select({ scriptRef: scriptRuns.scriptRef, startedAt: scriptRuns.startedAt, steps: scriptRuns.steps })
      .from(scriptRuns)
      .where(and(eq(scriptRuns.creatorId, creatorId), sql`${scriptRuns.startedAt} >= ${since}`))
      .orderBy(scriptRuns.startedAt, scriptRuns.id);
    return rows.map((row) => ({
      scriptRef: row.scriptRef,
      startedAt: row.startedAt,
      steps: ScriptRunStepsSchema.parse(row.steps),
    }));
  });
}
