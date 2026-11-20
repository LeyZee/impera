import {
  calendarDayAt,
  CreatorEarningsQuerySchema,
  CreatorEarningsSchema,
  DomainError,
  EARNINGS_MAX_DAYS_BACK,
  FanIdSchema,
  UserIdSchema,
  type CreatorEarnings,
  type CreatorEarningsQuery,
  type FanId,
  type UserId,
} from '@impera/contracts';
import { inArray, NotACreatorAccount, schema, withCreatorAccount, type Database } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { creatorEarnings, periodRange, readableDay } from '../../domain/creator-earnings';
import { SALES_FEED_TIME_ZONES } from '../../domain/sale-days';
import { creatorSalesReads } from '../db/creator-sales-reads';

class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

class EarningsDayInvalid extends DomainError {
  constructor() {
    super('request_invalid', 'Ce jour ne se lit pas : il est à venir, ou trop ancien');
  }
}

/**
 * Her Ventes (CR-04), read in her own account (`withCreatorAccount`): her sales through the view `creator_sales`, and
 * the names of the fans whose card is hers. Her days are the platform's (Reveal counts in Paris), as her totals.
 */
export function createCreatorEarningsReader(db: Database) {
  return async (userId: UserId, query: CreatorEarningsQuery, now: Date): Promise<CreatorEarnings> => {
    const today = calendarDayAt(now, SALES_FEED_TIME_ZONES.reveal);
    const day = query.day ?? today;
    if (!readableDay(day, today, EARNINGS_MAX_DAYS_BACK)) throw new EarningsDayInvalid();
    const range = periodRange(query.period, day);
    return withCreatorAccount(db, userId, async (tx) => {
      const sales = await creatorSalesReads.salesOf(tx, range);
      const ids = [...new Set(sales.lines.flatMap((line) => (line.fanId === null ? [] : [line.fanId])))];
      const named =
        ids.length === 0
          ? []
          : await tx
              .select({ id: schema.fans.id, displayName: schema.fans.displayName })
              .from(schema.fans)
              .where(inArray(schema.fans.id, ids));
      const names = new Map<FanId, string>();
      for (const fan of named) {
        const name = fan.displayName.trim();
        if (name !== '') names.set(FanIdSchema.parse(fan.id), name);
      }
      return creatorEarnings(sales, { period: query.period, today, names });
    });
  };
}

/** `GET /v1/creator-space/earnings` (creator only, CR-04): her part over a day, a fortnight or a month. */
export function createCreatorEarningsRoutes(
  read: (userId: UserId, query: CreatorEarningsQuery, now: Date) => Promise<CreatorEarnings>,
  guard: preValidationAsyncHookHandler,
  now: () => Date,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creator-space/earnings',
      {
        preValidation: guard,
        schema: { querystring: CreatorEarningsQuerySchema, response: { 200: CreatorEarningsSchema } },
      },
      async (request) => {
        if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        try {
          return await read(UserIdSchema.parse(request.user.id), request.query, now());
        } catch (error) {
          if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
          throw error;
        }
      },
    );
    return Promise.resolve();
  };
}
