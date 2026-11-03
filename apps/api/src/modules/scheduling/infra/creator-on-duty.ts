import {
  CreatorOnDutyListSchema,
  DomainError,
  UserIdSchema,
  type CreatorOnDutyList,
  type UserId,
} from '@nirvana/contracts';
import { and, eq, NotACreatorAccount, schema, sql, withCreatorAccount, type Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

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

/** `GET /v1/creator-space/on-duty` (creator only): who chats for her now, and in the next 24 hours. */
export function createCreatorOnDutyRoutes(
  read: (userId: UserId, now: Date) => Promise<CreatorOnDutyList>,
  requireRole: RequireRole,
  now: () => Date,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creator-space/on-duty',
      { preValidation: requireRole('creator'), schema: { response: { 200: CreatorOnDutyListSchema } } },
      async (request) => {
        if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        try {
          return await read(UserIdSchema.parse(request.user.id), now());
        } catch (error) {
          if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
          throw error;
        }
      },
    );
    return Promise.resolve();
  };
}
