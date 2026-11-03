import {
  BasisPointsSchema,
  CalendarDaySchema,
  CreatorIdSchema,
  EVENT_PAYLOADS,
  EventIdSchema,
  newId,
  payPeriodLastDay,
  payPeriodOfDay,
  previousPayPeriod,
  type CreatorId,
  type PayPeriod,
  type SalesTotals,
} from '@nirvana/contracts';
import { schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import { agencyShareGaps } from '../domain/agency-shares';
import { calendarDayIn } from '../domain/time';

import { agencyTimeZone } from './rows';

/**
 * The sales totals of a creator from `from` to `to` (the `connectors` module's `salesFeedTotals.totalsOf`, given by
 * the composition root), read in the caller's transaction: the job's admin connection here.
 */
export type SalesTotalsRead = (
  tx: Transaction,
  query: { readonly creatorId: CreatorId; readonly from: string; readonly to: string },
) => Promise<SalesTotals>;

const RateRowSchema = z.object({
  creator_id: CreatorIdSchema,
  from_day: CalendarDaySchema,
  agency_bps: BasisPointsSchema,
});

/** The fortnight that ended before today in the agency's zone, the zone of the pay periods and of the percentages. */
function fortnightBefore(now: Date, timeZone: string): { readonly from: PayPeriod; readonly to: string } {
  const from = previousPayPeriod(payPeriodOfDay(calendarDayIn(now, timeZone)));
  return { from, to: payPeriodLastDay(from) };
}

/**
 * The automatic check of the agency's percentages (CRM-04 lot d3), on the admin connection: each creator with a
 * percentage in force on some day of the fortnight just over, her totals read on the register, and one
 * `agency_share_mismatch` per account and currency that differs (index `domain_events_agency_share_mismatch_unique`,
 * so a run again publishes nothing new). One transaction per creator. It reads the register and writes nothing but
 * the outbox: no amount, no rule, no pay.
 */
export function createDrizzleAgencyShareCheck(
  adminDb: Database,
  totalsOf: SalesTotalsRead,
): { run(now: Date, correlationId: string): Promise<number> } {
  return {
    async run(now, correlationId) {
      const { from, to, rates } = await withAdmin(adminDb, async (tx) => {
        const fortnight = fortnightBefore(now, await agencyTimeZone(tx));
        // Every percentage that starts by the fortnight's last day: an older one may still be in force on its days.
        const result = await tx.execute(sql`
          select creator_id, from_day::text as from_day, agency_bps
            from creator_agency_rates
           where from_day <= ${fortnight.to}::date
           order by creator_id, from_day`);
        return { ...fortnight, rates: result.rows.map((row) => RateRowSchema.parse(row)) };
      });
      const byCreator = new Map<CreatorId, { fromDay: string; agencyBps: number }[]>();
      for (const rate of rates) {
        const hers = byCreator.get(rate.creator_id) ?? [];
        hers.push({ fromDay: rate.from_day, agencyBps: rate.agency_bps });
        byCreator.set(rate.creator_id, hers);
      }
      let published = 0;
      for (const [creatorId, hers] of byCreator) {
        published += await withAdmin(adminDb, async (tx) => {
          const totals = await totalsOf(tx, { creatorId, from, to });
          let inserted = 0;
          for (const gap of agencyShareGaps(totals.rows, hers)) {
            const rows = await tx
              .insert(schema.domainEvents)
              .values({
                id: newId(EventIdSchema),
                creatorId,
                type: 'agency_share_mismatch',
                payload: EVENT_PAYLOADS.agency_share_mismatch.parse({ creatorId, from, to, ...gap }),
                actor: 'system',
                correlationId,
              })
              .onConflictDoNothing()
              .returning({ id: schema.domainEvents.id });
            inserted += rows.length;
          }
          return inserted;
        });
      }
      return published;
    },
  };
}
