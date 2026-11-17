import { KycSlotSchema } from '@impera/contracts';
import { and, eq, schema, withTenant, type Database } from '@impera/db';
import { z } from 'zod';

import type { NoteLineMemory } from '../../domain/agency-note';
import type { NoteLineStore } from '../../domain/ports';

const lines = schema.connectorNoteLines;

const OwnerSchema = z.enum(['agent', 'human']);

/** `connector_note_lines` (ADR 0117 § 3), each call in the creator's tenant: keyed marks only, never a line. */
export function createNoteLineStore(db: Database): NoteLineStore {
  return {
    lines: (account, platformFanId) =>
      withTenant(db, account.creatorId, async (tx) => {
        const rows = await tx
          .select()
          .from(lines)
          .where(and(eq(lines.platformAccountId, account.id), eq(lines.platformFanId, platformFanId)));
        return rows.map((row): NoteLineMemory => ({
          slot: KycSlotSchema.parse(row.slot),
          hash: row.lineHash,
          owner: OwnerSchema.parse(row.owner),
          corrected: row.corrected,
          locked: row.locked,
        }));
      }),

    remember: (account, platformFanId, remembered, at) =>
      withTenant(db, account.creatorId, async (tx) => {
        for (const line of remembered) {
          const values = {
            lineHash: line.hash,
            owner: line.owner,
            corrected: line.corrected,
            locked: line.locked,
            updatedAt: at,
          };
          await tx
            .insert(lines)
            .values({
              creatorId: account.creatorId,
              platformAccountId: account.id,
              platformFanId,
              slot: line.slot,
              ...values,
            })
            .onConflictDoUpdate({
              target: [lines.platformAccountId, lines.platformFanId, lines.slot],
              set: values,
            });
        }
      }),
  };
}
