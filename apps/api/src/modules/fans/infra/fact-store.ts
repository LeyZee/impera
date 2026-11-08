import { randomUUID } from 'node:crypto';

import { FactCategorySchema, MessageIdSchema, StoredFactKindSchema, UserIdSchema } from '@impera/contracts';
import { and, eq, inArray, schema, sql, withTenant, type Database, type Transaction } from '@impera/db';

import { FanNotFound } from '../domain/errors';
import type { StoredFact } from '../domain/facts';
import type { FactStore } from '../domain/fan';

type FactRow = typeof schema.fanFacts.$inferSelect;

// Read back through the contract's enums: a column is a boundary.
function toFact(row: FactRow): StoredFact {
  return {
    id: row.id,
    category: FactCategorySchema.parse(row.category),
    key: row.key,
    value: row.value,
    kind: StoredFactKindSchema.parse(row.kind),
    confidence: row.confidence,
    sourceMessageId: row.sourceMessageId === null ? null : MessageIdSchema.parse(row.sourceMessageId),
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    supersededBy: row.supersededBy,
    notedBy: row.notedBy === null ? null : UserIdSchema.parse(row.notedBy),
  };
}

async function current(tx: Transaction, creatorId: string, fanId: string): Promise<StoredFact[]> {
  const rows = await tx
    .select()
    .from(schema.fanFacts)
    .where(
      and(
        eq(schema.fanFacts.creatorId, creatorId),
        eq(schema.fanFacts.fanId, fanId),
        sql`${schema.fanFacts.supersededBy} is null`,
      ),
    );
  return rows.map(toFact);
}

/**
 * What waits « à vérifier » under a chatter's note (ADR 0085 § 6): values the AI read after it, written already
 * superseded by that note, while that note is still the field's value. The card and the planner read them; no prompt ever does.
 */
async function pending(tx: Transaction, creatorId: string, fanId: string): Promise<StoredFact[]> {
  const rows = await tx
    .select()
    .from(schema.fanFacts)
    .where(
      and(
        eq(schema.fanFacts.creatorId, creatorId),
        eq(schema.fanFacts.fanId, fanId),
        sql`${schema.fanFacts.kind} <> 'noted'`,
        sql`exists (select 1 from fan_facts note
                    where note.id = ${schema.fanFacts.supersededBy} and note.superseded_by is null
                      and note.kind = 'noted' and note.observed_at < ${schema.fanFacts.observedAt})`,
      ),
    );
  return rows.map(toFact);
}

/** The display names of the members who noted these facts (ADR 0085 § 5). */
async function namesOf(tx: Transaction, facts: readonly StoredFact[]): Promise<Map<string, string>> {
  const ids = [...new Set(facts.flatMap((fact) => (fact.notedBy ? [fact.notedBy] : [])))];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .where(inArray(schema.user.id, ids));
  return new Map(rows.filter((row) => row.name.trim() !== '').map((row) => [row.id, row.name]));
}

export function createDrizzleFactStore(db: Database): FactStore {
  return {
    current: (creatorId, fanId) => withTenant(db, creatorId, (tx) => current(tx, creatorId, fanId)),
    card: (creatorId, fanId) =>
      withTenant(db, creatorId, async (tx) => {
        const active = await current(tx, creatorId, fanId);
        const waiting = await pending(tx, creatorId, fanId);
        return { active, pending: waiting, names: await namesOf(tx, [...active, ...waiting]) };
      }),
    write: (creatorId, fanId, plan) =>
      withTenant(db, creatorId, async (tx) => {
        const [fan] = await tx
          .select({ id: schema.fans.id })
          .from(schema.fans)
          .where(and(eq(schema.fans.id, fanId), eq(schema.fans.creatorId, creatorId)))
          .for('update');
        if (fan === undefined) throw new FanNotFound();
        const written: StoredFact[] = [];
        const plans = plan(await current(tx, creatorId, fanId), await pending(tx, creatorId, fanId));
        for (const { fact, supersedes, overriddenBy, alsoSupersedes = [] } of plans) {
          const [row] = await tx
            .insert(schema.fanFacts)
            .values({
              id: randomUUID(),
              creatorId,
              fanId,
              ...fact,
              notedBy: fact.notedBy ?? null,
              // « À vérifier »: written under the chatter's note, never active (ADR 0085 § 6).
              supersededBy: overriddenBy ?? null,
            })
            .returning();
          if (row === undefined) throw new Error('Fact insert returned no row');
          const superseded = [...(supersedes === null ? [] : [supersedes]), ...alsoSupersedes];
          if (superseded.length > 0) {
            await tx
              .update(schema.fanFacts)
              .set({ supersededBy: row.id })
              .where(
                and(inArray(schema.fanFacts.id, superseded), sql`${schema.fanFacts.supersededBy} is null`),
              );
          }
          written.push(toFact(row));
        }
        return written;
      }),
  };
}
