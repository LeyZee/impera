import {
  calendarDayAt,
  payPeriodLastDay,
  payPeriodOfDay,
  previousPayPeriod,
  type CreatorEarnings,
  type CreatorSales,
  type UserId,
} from '@impera/contracts';
import { eq, schema, withCreatorAccount, type Database, type Transaction } from '@impera/db';

import { creatorEarnings } from '../domain/creator-earnings';

import { agencyTimeZone } from './rows';

/**
 * Her sales over a range, read on her view in her own transaction: the `connectors` module's
 * `creatorSalesReads.salesOf`, the range read in `timeZone`, each day said in `dayTimeZone`.
 */
export type CreatorSalesRead = (
  tx: Transaction,
  range: {
    readonly from: string;
    readonly to: string;
    readonly timeZone: string;
    readonly dayTimeZone: string;
  },
) => Promise<CreatorSales>;

/**
 * Her share, the fortnight in course then the one before (ADR 0106 amendment of 16/11, § 15 to § 20): through her own
 * account (`withCreatorAccount`), so her creator comes from the session, never from the request, and the view
 * `creator_sales` gives her her own lines only. The fortnights are the team's pay's, bounded in the agency's zone, so
 * that her total of a fortnight is what pay reads; each sale is said on its day in her own zone, near a bound a day
 * past the fortnight's, never moved to the other (Bilan, 16/11).
 */
export function createDrizzleCreatorEarnings(db: Database, adminDb: Database, salesOf: CreatorSalesRead) {
  return async (userId: UserId, now: Date): Promise<CreatorEarnings> => {
    // The agency's zone, a setting her account does not read: on the admin connection, nothing of hers with it.
    const agencyZone = await adminDb.transaction((tx) => agencyTimeZone(tx));
    const agencyToday = calendarDayAt(now, agencyZone);
    const current = payPeriodOfDay(agencyToday);
    const previous = previousPayPeriod(current);
    return withCreatorAccount(db, userId, async (tx, creatorId) => {
      const [creator] = await tx
        .select({ timeZone: schema.creators.timezone })
        .from(schema.creators)
        .where(eq(schema.creators.id, creatorId));
      if (creator === undefined) throw new Error(`creator ${creatorId} of a creator account not found`);
      const dayTimeZone = creator.timeZone;
      // One transaction, one connection: the two reads one after the other.
      const inCourse = await salesOf(tx, {
        from: current,
        to: agencyToday,
        timeZone: agencyZone,
        dayTimeZone,
      });
      const before = await salesOf(tx, {
        from: previous,
        to: payPeriodLastDay(previous),
        timeZone: agencyZone,
        dayTimeZone,
      });
      return {
        timeZone: dayTimeZone,
        today: calendarDayAt(now, dayTimeZone),
        periods: [creatorEarnings(inCourse, current), creatorEarnings(before, previous)],
      };
    });
  };
}
