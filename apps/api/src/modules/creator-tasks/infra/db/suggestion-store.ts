import type { CreatorTaskWhen } from '@impera/contracts';
import { and, eq, schema, sql, withTenantMember, type Database, type Transaction } from '@impera/db';

import { addDays, calendarDayIn } from '../../../scheduling/pure';
import { availabilityWindows, type Interval } from '../../domain/availability';
import { SuggestionDeclinedRecently, SuggestionForbidden, SuggestionIdTaken } from '../../domain/errors';
import { firstPlacement, placementOf } from '../../domain/placement';
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

/** Her timed tasks and the suggestions still open and placed that cross `[from, to)`: what a suggestion never falls on. */
async function busyBetween(tx: Transaction, from: Date, to: Date): Promise<Interval[]> {
  const busyTasks = await tx
    .select({ startsAt: tasks.startsAt, endsAt: tasks.endsAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.kind, 'timed'),
        sql`${tasks.archivedAt} is null and ${tasks.startsAt} < ${to} and ${tasks.endsAt} > ${from}`,
      ),
    );
  const busySuggestions = await tx
    .select({ startsAt: suggestions.startsAt, endsAt: suggestions.endsAt })
    .from(suggestions)
    .where(
      and(
        eq(suggestions.state, 'suggested'),
        sql`${suggestions.startsAt} < ${to} and ${suggestions.endsAt} > ${from}`,
      ),
    );
  return [...busyTasks, ...busySuggestions].flatMap((row) =>
    row.startsAt === null || row.endsAt === null ? [] : [{ startsAt: row.startsAt, endsAt: row.endsAt }],
  );
}

/** Her open dispos as instants, over her days from `firstDay` to `lastDay`. */
async function windowsBetween(
  tx: Transaction,
  firstDay: string,
  lastDay: string,
  zone: string,
): Promise<Interval[]> {
  const open = await tx
    .select()
    .from(availabilities)
    .where(sql`${availabilities.archivedAt} is null`);
  return availabilityWindows(open.map(availabilityOf), firstDay, lastDay, zone);
}

/**
 * Where a timed suggestion falls (ADR 0042 § 4): inside one of her dispos, over none of her timed tasks nor of the
 * suggestions already placed and still open; otherwise undated.
 */
async function placed(tx: Transaction, wanted: Interval, zone: string): Promise<Interval | null> {
  const firstDay = addDays(calendarDayIn(wanted.startsAt, zone), -1);
  const lastDay = calendarDayIn(wanted.endsAt, zone);
  const windows = await windowsBetween(tx, firstDay, lastDay, zone);
  return placementOf(wanted, windows, await busyBetween(tx, wanted.startsAt, wanted.endsAt));
}

/** How far ahead a validated idea looks for room in her dispos (VEI-01 d): two weeks, then « Ma semaine ». */
const SHOOT_HORIZON_DAYS = 14;

/** The first room of `minutes` in her dispos from `now`, by the rules of `placed`. */
async function firstRoom(
  tx: Transaction,
  minutes: number,
  now: Date,
  zone: string,
): Promise<Interval | null> {
  const today = calendarDayIn(now, zone);
  const lastDay = addDays(today, SHOOT_HORIZON_DAYS);
  // The day before too: a dispo of last night may run past midnight.
  const windows = await windowsBetween(tx, addDays(today, -1), lastDay, zone);
  const until = windows.reduce((latest, window) => Math.max(latest, window.endsAt.getTime()), now.getTime());
  return firstPlacement(minutes, windows, await busyBetween(tx, now, new Date(until)), now);
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

    suggestShoot: (creatorId, userId, shoot, now) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!readsTeam(scope)) throw new SuggestionForbidden();
        const zone = await zoneOf(tx, creatorId);
        if (zone === null) throw new SuggestionForbidden();
        const [known] = await tx.select().from(suggestions).where(eq(suggestions.id, shoot.id));
        if (known !== undefined) {
          const stored = agencySuggestionOf(known);
          // The same shoot replayed answers itself; anything else under its id is refused.
          if (stored.title !== shoot.title || stored.shootBrief !== shoot.shootBrief)
            throw new SuggestionIdTaken();
          return stored;
        }
        const room = await firstRoom(tx, shoot.minutes, now, zone);
        const week = weekOf(calendarDayIn(room?.startsAt ?? now, zone));
        const identity = { category: 'shoot' as const, title: shoot.title };
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
        if (!maySuggest(identity, week, recent)) throw new SuggestionDeclinedRecently();
        const [row] = await tx
          .insert(suggestions)
          .values({
            id: shoot.id,
            creatorId,
            origin: 'agency',
            kind: 'timed',
            startsAt: room?.startsAt ?? null,
            endsAt: room?.endsAt ?? null,
            day: null,
            weekdays: null,
            minutes: shoot.minutes,
            week,
            category: identity.category,
            title: shoot.title,
            purpose: shoot.purpose,
            shootBrief: shoot.shootBrief,
            createdBy: userId,
          })
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
