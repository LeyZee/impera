import { createHash } from 'node:crypto';

import { VerdictSchema } from '@impera/contracts';
import { and, eq, inArray, schema, sql, withTenant, type Database } from '@impera/db';

import {
  CalibrationRecordSchema,
  type CalibrationRecord,
  type CalibrationStore,
  type VoiceExample,
} from '../../../agent/index';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The table's id for a rating: its own when it is a UUID, otherwise one derived from it, always the same, so the
 * ratings of the JSON lines are imported once however often the import runs (AGE-06).
 */
export function ratingRowId(id: string): string {
  if (UUID.test(id)) return id.toLowerCase();
  const hex = createHash('sha256').update(`impera:playground-rating:${id}`).digest('hex');
  // Shaped as a version 8 UUID (custom), variant 10.
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function rowOf(record: CalibrationRecord, creatorId: string): typeof schema.calibrationRatings.$inferInsert {
  // A correction filed as a voice example enters her bank (ADR 0102 § 1); the guards are read again on the way out.
  const isExample = record.verdict.kind === 'corrected' && record.destination === 'voice_example';
  const ratedAt = new Date(record.at);
  return {
    id: ratingRowId(record.id),
    creatorId,
    source: 'playground',
    sessionId: record.sessionId,
    ratedAt,
    voicePrompt: record.version.voicePrompt,
    voiceModel: record.version.voiceModel,
    verdictKind: record.verdict.kind,
    verdict: record.verdict,
    destination: record.destination ?? null,
    fanMessage: record.fanMessage,
    bubbles: [...record.bubbles],
    moment: record.moment,
    personaVersionId: record.personaVersionId ?? null,
    exampleState: isExample ? (record.exampleBlocked === true ? 'blocked' : 'active') : null,
    exampleStateAt: isExample ? ratedAt : null,
  };
}

function withoutDestination(record: CalibrationRecord): CalibrationRecord {
  const rating = { ...record };
  delete rating.destination;
  return rating;
}

/**
 * The playground's ratings in `calibration_ratings` (ADR 0103, AGE-06), inside each creator's tenant, in place of the
 * JSON lines on the PC: kept with the database and its backups. A rating that names no creator (the invented
 * persona) is not kept (ADR 0103 § 7). `creatorIds` lists the creators whose ratings are read back at start.
 */
export function createDbCalibrationStore(
  db: Database,
  creatorIds: () => Promise<readonly string[]>,
): CalibrationStore {
  return {
    async append(record) {
      const creatorId = record.creatorId;
      if (creatorId === undefined) return;
      await withTenant(db, creatorId, (tx) =>
        tx.insert(schema.calibrationRatings).values(rowOf(record, creatorId)).onConflictDoNothing(),
      );
    },
    async list() {
      const records: CalibrationRecord[] = [];
      for (const creatorId of await creatorIds()) {
        const rows = await withTenant(db, creatorId, (tx) =>
          tx
            .select()
            .from(schema.calibrationRatings)
            .where(
              and(
                eq(schema.calibrationRatings.creatorId, creatorId),
                eq(schema.calibrationRatings.source, 'playground'),
              ),
            )
            .orderBy(sql`${schema.calibrationRatings.ratedAt} asc`),
        );
        for (const row of rows) {
          // A moment purged after 90 days (migration 0005) cannot be replayed: the rating is no longer a record.
          if (row.moment === null || row.sessionId === null || row.fanMessage === null) continue;
          const parsed = CalibrationRecordSchema.safeParse({
            id: row.id,
            creatorId: row.creatorId,
            ...(row.personaVersionId !== null && { personaVersionId: row.personaVersionId }),
            sessionId: row.sessionId,
            at: row.ratedAt.toISOString(),
            version: { voicePrompt: row.voicePrompt, voiceModel: row.voiceModel },
            verdict: row.verdict,
            ...(row.destination !== null && { destination: row.destination }),
            fanMessage: row.fanMessage,
            bubbles: row.bubbles,
            moment: row.moment,
          });
          // A withdrawn example is no longer one (ADR 0102 § 5): it stays a rating, out of her bank.
          if (!parsed.success) continue;
          if (row.exampleState === 'withdrawn') records.push(withoutDestination(parsed.data));
          else if (row.exampleState === 'blocked') records.push({ ...parsed.data, exampleBlocked: true });
          else records.push(parsed.data);
        }
      }
      return records.sort((a, b) => a.at.localeCompare(b.at));
    },
  };
}

/** Read past what her guards may set aside, so twelve remain whenever her bank holds them (ADR 0102 § 2, § 4). */
const BANK_READ = 48;

/**
 * Her bank, newest first (ADR 0102 § 1, § 2): her corrections filed as voice examples and still `active`, in her
 * tenant only, whichever of her versions they were made on: one bank per creator, so activating a version keeps it and
 * a correction made on a draft serves the version in force. Withdrawn or blocked ones never leave. The version that
 * writes chooses among them with its own guards (`pickVoiceExamples`), as the playground does.
 */
export function createDbVoiceExampleBank(
  db: Database,
): (creatorId: string) => Promise<readonly VoiceExample[]> {
  return async (creatorId) => {
    const rows = await withTenant(db, creatorId, (tx) =>
      tx
        .select({ id: schema.calibrationRatings.id, verdict: schema.calibrationRatings.verdict })
        .from(schema.calibrationRatings)
        .where(
          and(
            eq(schema.calibrationRatings.creatorId, creatorId),
            eq(schema.calibrationRatings.exampleState, 'active'),
          ),
        )
        .orderBy(sql`${schema.calibrationRatings.ratedAt} desc`)
        .limit(BANK_READ),
    );
    return rows.flatMap((row) => {
      const verdict = VerdictSchema.safeParse(row.verdict);
      return verdict.success && verdict.data.kind === 'corrected'
        ? [{ id: row.id, text: verdict.data.text }]
        : [];
    });
  };
}

/** One correction of her bank as Entraîner lists it (ADR 0102 § 5); withdrawn ones are never listed. */
export interface BankEntry {
  readonly id: string;
  readonly text: string;
  readonly fanMessage: string;
  readonly ratedAt: Date;
  readonly state: 'active' | 'blocked';
}

/** Her bank as the owner sees it and empties it (ADR 0102 § 5). */
export interface VoiceBankStore {
  /** Her examples, whichever of her versions they were made on, active or blocked, newest first (ADR 0102 § 1). */
  list(creatorId: string): Promise<readonly BankEntry[]>;
  /** Out of her bank everywhere, kept for history; false when it is not in her bank. */
  withdraw(creatorId: string, id: string, at: Date): Promise<boolean>;
}

/** How many of her examples Entraîner lists: the twelve read, and enough behind them to choose what to withdraw. */
const BANK_LISTED = 100;

export function createDbVoiceBankStore(db: Database): VoiceBankStore {
  const ratings = schema.calibrationRatings;
  return {
    async list(creatorId) {
      const rows = await withTenant(db, creatorId, (tx) =>
        tx
          .select({
            id: ratings.id,
            verdict: ratings.verdict,
            fanMessage: ratings.fanMessage,
            ratedAt: ratings.ratedAt,
            state: ratings.exampleState,
          })
          .from(ratings)
          .where(and(eq(ratings.creatorId, creatorId), inArray(ratings.exampleState, ['active', 'blocked'])))
          .orderBy(sql`${ratings.ratedAt} desc`)
          .limit(BANK_LISTED),
      );
      return rows.flatMap((row) => {
        const verdict = VerdictSchema.safeParse(row.verdict);
        if (!verdict.success || verdict.data.kind !== 'corrected') return [];
        const state = row.state === 'blocked' ? 'blocked' : 'active';
        return [
          {
            id: row.id,
            text: verdict.data.text,
            fanMessage: row.fanMessage ?? '',
            ratedAt: row.ratedAt,
            state,
          },
        ];
      });
    },
    async withdraw(creatorId, id, at) {
      const changed = await withTenant(db, creatorId, (tx) =>
        tx
          .update(ratings)
          .set({ exampleState: 'withdrawn', exampleStateAt: at })
          .where(
            and(
              eq(ratings.id, id),
              eq(ratings.creatorId, creatorId),
              inArray(ratings.exampleState, ['active', 'blocked']),
            ),
          )
          .returning({ id: ratings.id }),
      );
      return changed.length > 0;
    },
  };
}

/** What the one-time import of the JSON lines did: kept, already there, or not kept and why. */
export interface RatingImport {
  readonly read: number;
  readonly kept: number;
  /** Ratings of the invented persona or of no creator: never anyone's (ADR 0103 § 7). */
  readonly withoutCreator: number;
  /** Refused by the table (a persona version or a creator that no longer exists). */
  readonly refused: number;
}

/**
 * Copies the ratings of the JSON lines into the table: each keeps an id derived from its own, so running it
 * again adds nothing. The file is left as it is; nothing is deleted (CLAUDE.md rule 12).
 */
export async function importRatings(from: CalibrationStore, into: CalibrationStore): Promise<RatingImport> {
  const records = await from.list();
  let kept = 0;
  let withoutCreator = 0;
  let refused = 0;
  for (const record of records) {
    if (record.creatorId === undefined) {
      withoutCreator += 1;
      continue;
    }
    try {
      await into.append(record);
      kept += 1;
    } catch {
      refused += 1;
    }
  }
  return { read: records.length, kept, withoutCreator, refused };
}
