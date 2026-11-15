import {
  BasisPointsSchema,
  CalendarDaySchema,
  CreatorAgencyRateIdSchema,
  CreatorIdSchema,
  payPeriodLastDay,
  payPeriodOfDay,
  previousPayPeriod,
  type CreatorAgencyRateList,
  type CreatorId,
  type PayPeriod,
} from '@impera/contracts';
import { and, eq, schema, SNAPSHOT_READ, sql, withTenantMember, type Database } from '@impera/db';
import { z } from 'zod';

import { assertRateStart } from '../domain/agency-rates';
import {
  AgencyRateConflict,
  AgencyRateDayConflict,
  AgencyRateForbidden,
  CreatorNotFound,
} from '../domain/errors';
import { observedShares } from '../domain/observed-shares';
import type { AgencyRatesStore, StoredAgencyRate } from '../domain/ports';
import { addDays, calendarDayIn } from '../domain/time';

import type { SalesTotalsRead } from './agency-share-check';
import { agencyTimeZone, audit, pgErrorOf } from './rows';

const { creatorAgencyRates } = schema;

const rateColumns = {
  id: creatorAgencyRates.id,
  creatorId: creatorAgencyRates.creatorId,
  fromDay: creatorAgencyRates.fromDay,
  agencyBps: creatorAgencyRates.agencyBps,
  createdAt: creatorAgencyRates.createdAt,
};

// The bounds are read again, as the table's check holds them: a row out of them fails here, never on a screen.
const StoredAgencyRateSchema = z.object({
  id: CreatorAgencyRateIdSchema,
  creatorId: CreatorIdSchema,
  fromDay: CalendarDaySchema,
  agencyBps: BasisPointsSchema,
  createdAt: z.date(),
});

const toRate = (row: unknown): StoredAgencyRate => StoredAgencyRateSchema.parse(row);

const LinkedRowSchema = z.object({ linked: z.boolean() });

const newestFirst = (a: StoredAgencyRate, b: StoredAgencyRate): number => b.fromDay.localeCompare(a.fromDay);

/** The fortnight in course and the two before it, newest first (ADR 0054 § 4). */
function lastFortnights(today: string): PayPeriod[] {
  const current = payPeriodOfDay(today);
  const previous = previousPayPeriod(current);
  return [current, previous, previousPayPeriod(previous)];
}

/**
 * The creators' agency percentages (CR-04) through `withTenantMember` in the creator: `owner_read` and `owner_insert`
 * let the owner alone read and add them, and the table refuses any change or removal, for every role. Today is the
 * agency's day (the zone of the pay periods), read in the same transaction, as the agency's share read on the register
 * (ADR 0054 § 4, the `connectors` module's totals), which needs no percentage.
 */
export function createDrizzleAgencyRatesStore(db: Database, totalsOf: SalesTotalsRead): AgencyRatesStore {
  const windowOf = async (
    tx: Parameters<SalesTotalsRead>[0],
    creatorId: CreatorId,
    from: string,
    to: string,
  ): Promise<CreatorAgencyRateList['observed']['last30Days']> => {
    const totals = await totalsOf(tx, { creatorId, from, to });
    return { from, to, shares: observedShares(totals.rows) };
  };
  return {
    list: (actor, creatorId, now) =>
      withTenantMember(
        db,
        creatorId,
        actor,
        async (tx, scope) => {
          if (scope !== 'owner') throw new AgencyRateForbidden();
          const today = calendarDayIn(now, await agencyTimeZone(tx));
          const rates = (await tx.select(rateColumns).from(creatorAgencyRates))
            .map(toRate)
            .toSorted(newestFirst);
          const last30Days = await windowOf(tx, creatorId, addDays(today, -29), today);
          const fortnights = [];
          for (const period of lastFortnights(today)) {
            const last = payPeriodLastDay(period);
            // The fortnight in course is read up to today: a day to come has no sale.
            fortnights.push(await windowOf(tx, creatorId, period, last > today ? today : last));
          }
          // An account linked to a sales feed (ADR 0050 § 3): her share is read there, sale or not.
          const feeds = await tx.execute(
            sql`select exists (select 1 from sales_feed_models where creator_id = ${creatorId}) as linked`,
          );
          const linked = LinkedRowSchema.parse(feeds.rows[0]).linked;
          return { today, rates, observed: { linked, last30Days, fortnights } };
        },
        SNAPSHOT_READ,
      ),

    create: (actor, creatorId, rate, now) =>
      withTenantMember(db, creatorId, actor.userId, async (tx, scope) => {
        if (scope !== 'owner') throw new AgencyRateForbidden();
        // Whether this one is her first is read under her lock: two sent at once never both pass as the first (Bilan).
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`scheduling.agency_rate:${creatorId}`}, 0))`,
        );
        const [existing] = await tx
          .select(rateColumns)
          .from(creatorAgencyRates)
          .where(eq(creatorAgencyRates.id, rate.id));
        if (existing !== undefined) {
          const same =
            existing.creatorId === creatorId &&
            existing.fromDay === rate.fromDay &&
            existing.agencyBps === rate.agencyBps;
          if (!same) throw new AgencyRateConflict();
          return { rate: toRate(existing), created: false };
        }
        const hers = await tx
          .select({ id: creatorAgencyRates.id, fromDay: creatorAgencyRates.fromDay })
          .from(creatorAgencyRates);
        const taken = hers.find((one) => one.fromDay === rate.fromDay);
        if (taken !== undefined) throw new AgencyRateDayConflict(taken.id);
        assertRateStart(rate.fromDay, calendarDayIn(now, await agencyTimeZone(tx)), hers.length === 0);
        try {
          await tx.transaction((savepoint) =>
            savepoint.insert(creatorAgencyRates).values({ ...rate, creatorId, createdBy: actor.userId }),
          );
        } catch (error) {
          const failure = pgErrorOf(error);
          // 23503: no such creator (the foreign key); 23505: a race on her day, or an id another creator holds.
          if (failure?.code === '23503') throw new CreatorNotFound();
          if (failure?.code !== '23505') throw error;
          if (failure.constraint !== 'creator_agency_rates_creator_day_unique')
            throw new AgencyRateConflict();
          const [raced] = await tx
            .select({ id: creatorAgencyRates.id })
            .from(creatorAgencyRates)
            .where(
              and(eq(creatorAgencyRates.creatorId, creatorId), eq(creatorAgencyRates.fromDay, rate.fromDay)),
            );
          throw new AgencyRateDayConflict(raced?.id ?? rate.id);
        }
        await audit(
          tx,
          actor,
          'creator_agency_rate.create',
          { kind: 'creator_agency_rate', id: rate.id },
          { creatorId, fromDay: rate.fromDay, agencyBps: rate.agencyBps },
        );
        const [created] = await tx
          .select(rateColumns)
          .from(creatorAgencyRates)
          .where(eq(creatorAgencyRates.id, rate.id));
        if (created === undefined) throw new AgencyRateConflict();
        return { rate: toRate(created), created: true };
      }),
  };
}
