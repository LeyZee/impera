import type { CreatorTaskWhen } from '@impera/contracts';
import { and, eq, schema, sql, withTenantMember, type Database, type Transaction } from '@impera/db';

import { addDays, calendarDayIn } from '../../../scheduling/pure';
import { availabilityWindows, type Interval } from '../../domain/availability';
import { SuggestionDeclinedRecently, SuggestionForbidden, SuggestionIdTaken } from '../../domain/errors';
import { placementOf } from '../../domain/placement';
import type { AgencySuggestionStore } from '../../domain/ports';
import { maySuggest, weekOf } from '../../domain/suggestions';

import { agencySuggestionOf, availabilityOf, whenColumns } from './rows';

const tasks = schema.creatorTasks;
const availabilities = schema.creatorAvailabilities;
const suggestions = schema.creatorSuggestions;

const readsTeam = (scope: string): boolean => scope === 'owner' || scope === 'agency';

async function zoneOf(tx: Transaction, creatorId: string): Promise<string | null> {
  const [creator] = await tx
    .select({ timeZone: schema.creators.timezone })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));
  return creator?.timeZone ?? null;
}

/**
 * Where a timed suggestion falls (ADR 0042 § 4): inside one of her dispos, over none of her timed tasks nor of the
 * suggestions already placed and still open; otherwise undated.
 */
async function placed(tx: Transaction, wanted: Interval, zone: string): Promise<Interval | null> {
  const firstDay = addDays(calendarDayIn(wanted.startsAt, zone), -1);
  const lastDay = calendarDayIn(wanted.endsAt, zone);
  const open = await tx
    .select()
    .from(availabilities)
    .where(sql`${availabilities.archivedAt} is null`);
  const windows = availabilityWindows(open.map(availabilityOf), firstDay, lastDay, zone);
  const busyTasks = await tx
    .select({ startsAt: tasks.startsAt, endsAt: tasks.endsAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.kind, 'timed'),
        sql`${tasks.archivedAt} is null and ${tasks.startsAt} < ${wanted.endsAt} and ${tasks.endsAt} > ${wanted.startsAt}`,
      ),
    );
  const busySuggestions = await tx
    .select({ startsAt: suggestions.startsAt, endsAt: suggestions.endsAt })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.state, 'suggested'),
        sql`${suggestions.startsAt} < ${wanted.endsAt} and ${suggestions.endsAt} > ${wanted.startsAt}`,
      ),
    );
  const busy = [...busyTasks, ...busySuggestions].flatMap((row) =>
    row.startsAt === null || row.endsAt === null ? [] : [{ startsAt: row.startsAt, endsAt: row.endsAt }],
  );
  return placementOf(wanted, windows, busy);
}

/** `withTenantMember` for the owner and an active manager; a chatter is refused before any read. */
export function createDrizzleSuggestionStore(db: Database): AgencySuggestionStore {
  return {
    create: (creatorId, userId, body, now) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!readsTeam(scope)) throw new SuggestionForbidden();
        const zone = await zoneOf(tx, creatorId);
        if (zone === null) throw new SuggestionForbidden();
        const [known] = await tx.select().from(suggestions).where(eq(suggestions.id, body.id));
        if (known !== undefined) {
          const stored = agencySuggestionOf(known);
          // A replay of the same suggestion answers it; anything else under its id is refused.
          if (
            stored.title !== body.title ||
            stored.category !== body.category ||
            stored.purpose !== body.purpose
          )
            throw new SuggestionIdTaken();
          return stored;
        }
        const week = weekOfSuggestion(body.when, now, zone);
        const declined = await tx
          .select({
            category: suggestions.category,
            title: suggestions.title,
            declinedOn: suggestions.decidedOn,
          })
          .from(suggestions)
          .where(
            and(eq(suggestions.state, 'declined'), sql`${suggestions.decidedOn} >= ${addDays(week, -7)}`),
          );
        const recent = declined.flatMap((row) =>
          row.declinedOn === null ? [] : [{ ...row, declinedOn: row.declinedOn }],
        );
        if (!maySuggest(body, week, recent)) throw new SuggestionDeclinedRecently();
        let columns = whenColumns(body.when);
        let minutes: number | null = null;
        if (body.when.kind === 'timed') {
          const wanted = { startsAt: new Date(body.when.startsAt), endsAt: new Date(body.when.endsAt) };
          minutes = Math.round((wanted.endsAt.getTime() - wanted.startsAt.getTime()) / 60_000);
          if ((await placed(tx, wanted, zone)) === null)
            columns = { ...columns, startsAt: null, endsAt: null };
        }
        const [row] = await tx
          .insert(suggestions)
          .values({
            id: body.id,
            creatorId,
            origin: 'agency',
            ...columns,
            minutes,
            week,
            category: body.category,
            title: body.title,
            purpose: body.purpose,
            createdBy: userId,
          })
          // An id already used for another creator, which her RLS hides: a conflict, never a 500.
          .onConflictDoNothing()
          .returning();
        if (row === undefined) throw new SuggestionIdTaken();
        return agencySuggestionOf(row);
      }),

    list: (creatorId, userId, week) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!readsTeam(scope)) throw new SuggestionForbidden();
        const rows = await tx
          .select()
          .from(suggestions)
          .where(eq(suggestions.week, weekOf(week)))
          .orderBy(suggestions.createdAt);
        return { items: rows.map(agencySuggestionOf) };
      }),
  };
}

/** The week a suggestion is for: the one it falls in, or for her routine, the week it is suggested. */
function weekOfSuggestion(when: CreatorTaskWhen, now: Date, zone: string): string {
  if (when.kind === 'timed') return weekOf(calendarDayIn(new Date(when.startsAt), zone));
  if (when.kind === 'day') return weekOf(when.day);
  return weekOf(calendarDayIn(now, zone));
}
