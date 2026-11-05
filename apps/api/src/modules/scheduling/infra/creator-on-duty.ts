import {
  CreatorAccountShiftsQuerySchema,
  CreatorAccountShiftsSchema,
  CreatorOnDutyListSchema,
  DomainError,
  PlatformSchema,
  UserIdSchema,
  type CreatorAccountShifts,
  type CreatorAccountShiftsQuery,
  type CreatorOnDutyList,
  type UserId,
} from '@impera/contracts';
import { and, eq, NotACreatorAccount, schema, sql, withCreatorAccount, type Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { CreatorShiftsFeed } from '../domain/ports';

import type { RequireRole } from './routes';

/** How far ahead « Bientôt » looks. */
const NEXT_WINDOW_MS = 24 * 3_600_000;

class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

/**
 * « Qui est en poste » for the creator (CR-02, ADR 0023): read from the `creator_on_duty` view through her own door, so
 * the team's tables stay closed to her and only a display name and a range come out.
 */
export function createDrizzleCreatorOnDuty(db: Database) {
  return async (userId: UserId, now: Date): Promise<CreatorOnDutyList> => {
    const until = new Date(now.getTime() + NEXT_WINDOW_MS);
    const rows = await withCreatorAccount(db, userId, (tx) =>
      tx
        .select({
          displayName: schema.creatorOnDuty.displayName,
          handle: schema.platformAccounts.handle,
          startsAt: schema.creatorOnDuty.startsAt,
          endsAt: schema.creatorOnDuty.endsAt,
        })
        .from(schema.creatorOnDuty)
        .innerJoin(
          schema.platformAccounts,
          eq(schema.platformAccounts.id, schema.creatorOnDuty.platformAccountId),
        )
        .where(
          and(
            sql`${schema.creatorOnDuty.endsAt} > ${now.toISOString()}::timestamptz`,
            sql`${schema.creatorOnDuty.startsAt} <= ${until.toISOString()}::timestamptz`,
          ),
        )
        .orderBy(schema.creatorOnDuty.startsAt, schema.creatorOnDuty.displayName),
    );
    const shift = (row: (typeof rows)[number]) => ({
      displayName: row.displayName,
      handle: row.handle,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    });
    return {
      current: rows.filter((row) => row.startsAt <= now).map(shift),
      next: rows.filter((row) => row.startsAt > now).map(shift),
    };
  };
}

/** Her accounts' shifts that overlap `[from, to)`, by start then name, with the shift's id for the calendar feed. */
function accountShifts(db: Database, userId: UserId, from: string, to: string) {
  return withCreatorAccount(db, userId, (tx) =>
    tx
      .select({
        shiftId: schema.creatorOnDuty.shiftId,
        displayName: schema.creatorOnDuty.displayName,
        platform: schema.platformAccounts.platform,
        startsAt: schema.creatorOnDuty.startsAt,
        endsAt: schema.creatorOnDuty.endsAt,
      })
      .from(schema.creatorOnDuty)
      .innerJoin(
        schema.platformAccounts,
        eq(schema.platformAccounts.id, schema.creatorOnDuty.platformAccountId),
      )
      .where(
        and(
          sql`${schema.creatorOnDuty.endsAt} > ${from}::timestamptz`,
          sql`${schema.creatorOnDuty.startsAt} < ${to}::timestamptz`,
        ),
      )
      .orderBy(schema.creatorOnDuty.startsAt, schema.creatorOnDuty.displayName),
  );
}

/**
 * The shifts of her accounts over a range (CR-05 c3, ADR 0045 § 1), for « Qui répond à tes fans » in her Agenda: the
 * same view and the same door as « qui est en poste », with the platform of the account. A member who is not active
 * is not there: he does not answer her fans.
 */
export function createDrizzleCreatorAccountShifts(db: Database) {
  return async (userId: UserId, range: CreatorAccountShiftsQuery): Promise<CreatorAccountShifts> => {
    const rows = await accountShifts(db, userId, range.from, range.to);
    return {
      shifts: rows.map((row) => ({
        displayName: row.displayName,
        platform: PlatformSchema.parse(row.platform),
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      })),
    };
  };
}

/**
 * The same shifts for her calendar link (ADR 0045 § 5, CR-05), when she chose to add them: read through her own door,
 * with her rights, over the feed's window. Only a name, a platform and a range come out, and the shift's id, which the
 * feed hashes into a stable event id.
 */
export function createDrizzleCreatorShiftsFeed(db: Database): CreatorShiftsFeed {
  return async (userId, window) => {
    const rows = await accountShifts(db, userId, window.from.toISOString(), window.to.toISOString());
    return rows.map((row) => ({
      shiftId: row.shiftId,
      displayName: row.displayName,
      platform: PlatformSchema.parse(row.platform),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    }));
  };
}

export interface CreatorOnDutyReads {
  readonly onDuty: (userId: UserId, now: Date) => Promise<CreatorOnDutyList>;
  readonly shifts: (userId: UserId, range: CreatorAccountShiftsQuery) => Promise<CreatorAccountShifts>;
}

/**
 * Her doors to the team's calendar (creator only): `GET /v1/creator-space/on-duty`, who chats for her now and in the
 * next 24 hours; `GET /v1/creator-space/shifts`, her accounts' shifts over a range of her Agenda.
 */
export function createCreatorOnDutyRoutes(
  reads: CreatorOnDutyReads,
  requireRole: RequireRole,
  now: () => Date,
): FastifyPluginAsyncZod {
  return (app) => {
    const asCreator = async <T>(
      userId: string | undefined,
      run: (userId: UserId) => Promise<T>,
    ): Promise<T> => {
      if (userId === undefined) throw new DomainError('session_unauthenticated', 'Connexion requise');
      try {
        return await run(UserIdSchema.parse(userId));
      } catch (error) {
        if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
        throw error;
      }
    };
    app.get(
      '/creator-space/on-duty',
      { preValidation: requireRole('creator'), schema: { response: { 200: CreatorOnDutyListSchema } } },
      (request) => asCreator(request.user?.id, (userId) => reads.onDuty(userId, now())),
    );
    app.get(
      '/creator-space/shifts',
      {
        preValidation: requireRole('creator'),
        schema: {
          querystring: CreatorAccountShiftsQuerySchema,
          response: { 200: CreatorAccountShiftsSchema },
        },
      },
      (request) => asCreator(request.user?.id, (userId) => reads.shifts(userId, request.query)),
    );
    return Promise.resolve();
  };
}
