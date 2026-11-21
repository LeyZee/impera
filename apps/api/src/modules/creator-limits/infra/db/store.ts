import { CreatorIdSchema, type CreatorAbsence, type CreatorId, type CreatorStop } from '@impera/contracts';
import {
  and,
  eq,
  schema,
  sql,
  withCreatorAccount,
  withTenant,
  type Database,
  type Transaction,
} from '@impera/db';

import { calendarDayIn } from '../../../scheduling/pure';
import { AbsenceInPast } from '../../domain/errors';
import { canTellAbsence, limitsOf, type AbsenceRow, type StopRow } from '../../domain/limits';
import type { LimitStore } from '../../domain/ports';

const absences = schema.creatorAbsences;
const stops = schema.creatorStops;

async function todayOf(tx: Transaction, creatorId: string, now: Date): Promise<string> {
  const [creator] = await tx
    .select({ timeZone: schema.creators.timezone })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));
  return calendarDayIn(now, creator?.timeZone ?? 'Europe/Paris');
}

const absenceOf = (row: typeof absences.$inferSelect): CreatorAbsence => ({
  id: row.id,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

const stopOf = (row: typeof stops.$inferSelect): CreatorStop => ({
  id: row.id,
  what: row.what,
  createdAt: row.createdAt.toISOString(),
});

async function read(tx: Transaction, creatorId: CreatorId, now: Date) {
  const today = await todayOf(tx, creatorId, now);
  const absenceRows = await tx
    .select()
    .from(absences)
    .where(and(eq(absences.creatorId, creatorId), sql`${absences.endsOn} >= ${today}`));
  const stopRows = await tx.select().from(stops).where(eq(stops.creatorId, creatorId));
  const a: AbsenceRow[] = absenceRows.map((row) => ({
    ...absenceOf(row),
    cancelled: row.cancelledAt !== null,
  }));
  const s: StopRow[] = stopRows.map((row) => ({ ...stopOf(row), withdrawn: row.withdrawnAt !== null }));
  return limitsOf(creatorId, today, a, s);
}

/** Hers in her own account (`withCreatorAccount`); her team's through `withTenant`, after the route's own check. */
export function createDrizzleLimitStore(db: Database): LimitStore {
  return {
    mine: (userId, now) =>
      withCreatorAccount(db, userId, (tx, creatorId) => read(tx, CreatorIdSchema.parse(creatorId), now)),

    ofCreator: (creatorId, now) => withTenant(db, creatorId, (tx) => read(tx, creatorId, now)),

    tellAbsence: (userId, body, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        if (!canTellAbsence(body, await todayOf(tx, creatorId, now))) throw new AbsenceInPast();
        await tx
          .insert(absences)
          .values({
            id: body.id,
            creatorId,
            startsOn: body.startsOn,
            endsOn: body.endsOn,
            note: body.note === undefined || body.note === '' ? null : body.note,
            createdBy: userId,
          })
          .onConflictDoNothing();
        // A replay reads back what the first call wrote; another creator's id reads nothing and says so.
        const [row] = await tx.select().from(absences).where(eq(absences.id, body.id));
        if (row === undefined) throw new Error('creator-limits: absence not written');
        return absenceOf(row);
      }),

    cancelAbsence: (userId, id) =>
      withCreatorAccount(db, userId, async (tx) => {
        await tx
          .update(absences)
          .set({ cancelledAt: sql`now()`, cancelledBy: userId })
          .where(and(eq(absences.id, id), sql`${absences.cancelledAt} is null`));
      }),

    tellStop: (userId, body) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        await tx
          .insert(stops)
          .values({ id: body.id, creatorId, what: body.what, createdBy: userId })
          .onConflictDoNothing();
        const [row] = await tx.select().from(stops).where(eq(stops.id, body.id));
        if (row === undefined) throw new Error('creator-limits: stop not written');
        return stopOf(row);
      }),

    withdrawStop: (userId, id) =>
      withCreatorAccount(db, userId, async (tx) => {
        await tx
          .update(stops)
          .set({ withdrawnAt: sql`now()`, withdrawnBy: userId })
          .where(and(eq(stops.id, id), sql`${stops.withdrawnAt} is null`));
      }),
  };
}
