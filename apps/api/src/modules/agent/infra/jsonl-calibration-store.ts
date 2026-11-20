import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { DestinationSchema, MediaDescriptionSchema, VerdictSchema } from '@impera/contracts';
import { BriefSchema } from '@impera/llm';
import { z } from 'zod';

import { isTimeZone } from '../domain/situation';

import type { CalibrationRecord, CalibrationStore } from './calibration-record';

const TurnSchema = z.object({
  from: z.enum(['fan', 'creator']),
  text: z.string(),
  media: z
    .array(z.object({ description: MediaDescriptionSchema, isLocked: z.boolean().exactOptional() }))
    .exactOptional(),
});

/** A rating as kept, wherever it is kept: the JSON lines of before and the table read it back the same way. */
export const CalibrationRecordSchema = z.object({
  id: z.string().min(1),
  creatorId: z.string().min(1).exactOptional(),
  personaVersionId: z.string().min(1).exactOptional(),
  sessionId: z.string().min(1),
  at: z.string().min(1),
  version: z.object({ voicePrompt: z.string(), voiceModel: z.string() }),
  verdict: VerdictSchema,
  destination: DestinationSchema.exactOptional(),
  exampleBlocked: z.literal(true).exactOptional(),
  fanMessage: z.string(),
  bubbles: z.array(z.string()),
  moment: z.object({
    history: z.array(TurnSchema),
    fanNotes: z.string(),
    situation: z.object({
      now: z.coerce.date(),
      timeZone: z.string().refine(isTimeZone),
      relationshipStartedAt: z.coerce.date(),
      spentCents: z.number().int().nonnegative(),
    }),
    brief: BriefSchema.exactOptional(),
  }),
});

/**
 * Ratings as JSON lines, outside the repository (they hold persona phrasing): `.scratch/training/` or
 * `IMPERA_TRAINING_DIR`, until the database (P0-03). A damaged line is skipped, never fatal.
 */
export function createJsonlCalibrationStore(path: string): CalibrationStore {
  return {
    async append(record) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(CalibrationRecordSchema.parse(record))}\n`);
    },
    async list() {
      let source: string;
      try {
        source = await readFile(path, 'utf8');
      } catch {
        return [];
      }
      const records: CalibrationRecord[] = [];
      for (const line of source.split('\n')) {
        if (line.trim() === '') continue;
        try {
          const parsed = CalibrationRecordSchema.safeParse(JSON.parse(line));
          if (parsed.success) records.push(parsed.data);
        } catch {
          // Not JSON: a line cut by a crash. The others still count.
        }
      }
      return records;
    },
  };
}
