import { DesireMarkIdSchema, DesireMarkVerdictSchema, DesireSignalSchema } from '@impera/contracts';
import { eq, schema, sql, withTenant, type Database } from '@impera/db';
import { z } from 'zod';

import type { DesireMarkRecord, DesireMarkStore } from '../../application/desire-marks';

/** `desire_marks.reading` as written below: read back through its schema, never cast (CLAUDE.md rule 6). */
const ReadingSchema = z.object({
  before: z.number().int().nullable(),
  score: z.number().int(),
  signals: z.array(DesireSignalSchema),
});

/** `desire_marks` (migration 0185), inside her tenant: the owner's marks are hers, closed to her own account. */
export function createDbDesireMarkStore(db: Database): DesireMarkStore {
  return {
    async add(mark) {
      await withTenant(db, mark.creatorId, (tx) =>
        tx.insert(schema.desireMarks).values({
          id: mark.id,
          creatorId: mark.creatorId,
          fanMessageNumber: mark.fanMessageNumber,
          fanMessage: mark.fanMessage,
          verdict: mark.verdict,
          note: mark.note,
          reading: mark.reading,
          weightsVersion: mark.weightsVersion,
          markedBy: mark.markedBy,
          createdAt: mark.markedAt,
        }),
      );
    },
    async list(creatorId, limit) {
      const rows = await withTenant(db, creatorId, (tx) =>
        tx
          .select()
          .from(schema.desireMarks)
          .where(eq(schema.desireMarks.creatorId, creatorId))
          .orderBy(sql`${schema.desireMarks.createdAt} desc`)
          .limit(limit),
      );
      return rows.map((row): DesireMarkRecord => ({
        id: DesireMarkIdSchema.parse(row.id),
        creatorId: row.creatorId,
        fanMessageNumber: row.fanMessageNumber,
        fanMessage: row.fanMessage,
        verdict: DesireMarkVerdictSchema.parse(row.verdict),
        note: row.note,
        reading: ReadingSchema.parse(row.reading),
        weightsVersion: row.weightsVersion,
        markedBy: row.markedBy,
        markedAt: row.createdAt,
      }));
    },
  };
}
