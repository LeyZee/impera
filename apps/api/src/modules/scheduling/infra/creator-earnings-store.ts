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

/**
 * Her sales over a range, read on her view in her own transaction: the `connectors` module's
 * `creatorSalesReads.salesOf`, her days in `timeZone`.
 */
export type CreatorSalesRead = (
  tx: Transaction,
  range: { readonly from: string; readonly to: string; readonly timeZone: string },
) => Promise<CreatorSales>;

/**
 * Her share, the fortnight in course then the one before (ADR 0106 amendment of 16/11, § 15 to § 20): through her own
 * account (`withCreatorAccount`), so her creator comes from the session, never from the request, and the view
 * `creator_sales` gives her her own lines only. Her days and her fortnights are read in her own zone.
 */
export function createDrizzleCreatorEarnings(db: Database, salesOf: CreatorSalesRead) {
  return (userId: UserId, now: Date): Promise<CreatorEarnings> =>
    withCreatorAccount(db, userId, async (tx, creatorId) => {
      const [creator] = await tx
        .select({ timeZone: schema.creators.timezone })
        .from(schema.creators)
        .where(eq(schema.creators.id, creatorId));
      if (creator === undefined) throw new Error(`creator ${creatorId} of a creator account not found`);
      const { timeZone } = creator;
      const today = calendarDayAt(now, timeZone);
      const current = payPeriodOfDay(today);
      const previous = previousPayPeriod(current);
      // One transaction, one connection: the two reads one after the other.
      const inCourse = await salesOf(tx, { from: current, to: today, timeZone });
      const before = await salesOf(tx, { from: previous, to: payPeriodLastDay(previous), timeZone });
      return {
        timeZone,
        today,
        periods: [creatorEarnings(inCourse, current), creatorEarnings(before, previous)],
      };
    });
}
