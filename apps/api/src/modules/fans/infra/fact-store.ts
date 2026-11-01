import { randomUUID } from 'node:crypto';

import { FactCategorySchema, FactKindSchema, MessageIdSchema } from '@nirvana/contracts';
import { and, eq, schema, sql, withTenant, type Database, type Transaction } from '@nirvana/db';

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
    kind: FactKindSchema.parse(row.kind),
    confidence: row.confidence,
    sourceMessageId: row.sourceMessageId === null ? null : MessageIdSchema.parse(row.sourceMessageId),
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    supersededBy: row.supersededBy,
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

export function createDrizzleFactStore(db: Database): FactStore {
  return {
    current: (creatorId, fanId) => withTenant(db, creatorId, (tx) => current(tx, creatorId, fanId)),
    write: (creatorId, fanId, plan) =>
      withTenant(db, creatorId, async (tx) => {
        const [fan] = await tx
          .select({ id: schema.fans.id })
          .from(schema.fans)
          .where(and(eq(schema.fans.id, fanId), eq(schema.fans.creatorId, creatorId)))
          .for('update');
        if (fan === undefined) throw new FanNotFound();
        const written: StoredFact[] = [];
        for (const { fact, supersedes } of plan(await current(tx, creatorId, fanId))) {
          const [row] = await tx
            .insert(schema.fanFacts)
            .values({ id: randomUUID(), creatorId, fanId, ...fact })
            .returning();
          if (row === undefined) throw new Error('Fact insert returned no row');
          if (supersedes !== null) {
            await tx
              .update(schema.fanFacts)
              .set({ supersededBy: row.id })
              .where(and(eq(schema.fanFacts.id, supersedes), sql`${schema.fanFacts.supersededBy} is null`));
          }
          written.push(toFact(row));
        }
        return written;
      }),
  };
}
