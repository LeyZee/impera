import {
  newId,
  ScriptRunIdSchema,
  ScriptRunStatusSchema,
  ScriptRunStepsSchema,
  type ScriptRunStep,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenant, type Database } from '@impera/db';

import type { ScriptRun, ScriptRunRecord, ScriptRunStore } from '../../domain/script-run';

const { scriptRuns } = schema;

type Row = typeof scriptRuns.$inferSelect;

function toRecord(row: Row): ScriptRunRecord {
  // The steps are read back through their schema: a row another hand wrote wrong fails here, never further on.
  const steps = ScriptRunStepsSchema.parse(row.steps).map((step) => ({
    ...step,
    sentAt: new Date(step.sentAt),
    at: new Date(step.at),
  }));
  return {
    id: row.id,
    conversationId: row.conversationId,
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

function toStoredSteps(run: ScriptRun): ScriptRunStep[] {
  return ScriptRunStepsSchema.parse(
    run.steps.map((step) => ({ ...step, sentAt: step.sentAt.toISOString(), at: step.at.toISOString() })),
  );
}

/** `script_runs` under her tenant (ADR 0098), read and written by the application role. */
export function createDrizzleScriptRunStore(db: Database): ScriptRunStore {
  return {
    latest: (creatorId, conversationId) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select()
          .from(scriptRuns)
          .where(eq(scriptRuns.conversationId, conversationId))
          .orderBy(sql`${scriptRuns.startedAt} desc`, sql`${scriptRuns.id} desc`)
          .limit(1);
        return row === undefined ? null : toRecord(row);
      }),
    open: (creatorId, conversationId, run) =>
      withTenant(db, creatorId, async (tx) => {
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
        return row === undefined ? null : toRecord(row);
      }),
    save: (creatorId, record) =>
      withTenant(db, creatorId, async (tx) => {
        // Only an open run changes: once ended, it is history.
        const updated = await tx
          .update(scriptRuns)
          .set({
            status: record.run.status,
            steps: toStoredSteps(record.run),
            ignoredMessages: record.run.ignoredMessages,
            endedAt: record.run.endedAt,
            updatedAt: sql`now()`,
          })
          .where(and(eq(scriptRuns.id, record.id), eq(scriptRuns.status, 'open')))
          .returning({ id: scriptRuns.id });
        return updated.length === 1;
      }),
  };
}
