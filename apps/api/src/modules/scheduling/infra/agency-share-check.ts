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
} from '@impera/contracts';
import { schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import { agencyShareAlertMessage, type AgencyShareEvent } from '../domain/agency-share-alerts';
import { agencyShareGaps } from '../domain/agency-shares';
import { agencyShareChanges } from '../domain/observed-shares';
import type { Notify } from '../domain/ports';
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

const CreatorRowSchema = z.object({ id: CreatorIdSchema });

const OwnerRowSchema = z.object({ id: z.string().min(1) });

const AlertRowSchema = z.object({
  id: EventIdSchema,
  type: z.enum(['agency_share_mismatch', 'agency_share_changed']),
  payload: z.unknown(),
  display_name: z.string().min(1),
});

/** The stored event read again by its own contract: a payload out of it fails here, never on a device. */
function alertOf(row: z.infer<typeof AlertRowSchema>): AgencyShareEvent {
  return row.type === 'agency_share_mismatch'
    ? { type: row.type, payload: EVENT_PAYLOADS.agency_share_mismatch.parse(row.payload) }
    : { type: row.type, payload: EVENT_PAYLOADS.agency_share_changed.parse(row.payload) };
}

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
 * so a run again publishes nothing new). Then each creator, with a percentage or without: her share as the platform
 * reads it on that fortnight against the one before, and one `agency_share_changed` per account and currency whose
 * share moved by more than a point (ADR 0054 § 5, index `domain_events_agency_share_changed_unique`). One transaction
 * per creator and check. It reads the register and writes nothing but the outbox: no amount, no rule, no pay.
 *
 * Then each owner's account is told of every alert of that fortnight by a push notification (PAY-04 of the recette of
 * 16/11: Telegram alone left the CRM silent), once per account and event (`objectKey` is the event's id), so a run
 * again, or one after a failed send, rings nothing twice and forgets nothing. `notify` is `null` while push is off.
 */
export function createDrizzleAgencyShareCheck(
  adminDb: Database,
  totalsOf: SalesTotalsRead,
  notify: Notify | null,
): { run(now: Date, correlationId: string): Promise<number> } {
  return {
    async run(now, correlationId) {
      const { from, to, rates, creators } = await withAdmin(adminDb, async (tx) => {
        const fortnight = fortnightBefore(now, await agencyTimeZone(tx));
        // Every percentage that starts by the fortnight's last day: an older one may still be in force on its days.
        const result = await tx.execute(sql`
          select creator_id, from_day::text as from_day, agency_bps
            from creator_agency_rates
           where from_day <= ${fortnight.to}::date
           order by creator_id, from_day`);
        // Archived ones too: a fortnight of sales read before her archiving is still hers to compare.
        const all = await tx.execute(sql`select id from creators order by created_at, id`);
        return {
          ...fortnight,
          rates: result.rows.map((row) => RateRowSchema.parse(row)),
          creators: all.rows.map((row) => CreatorRowSchema.parse(row).id),
        };
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
      // The fortnight before the one just over, to compare her share with (ADR 0054 § 5).
      const before = previousPayPeriod(from);
      for (const creatorId of creators) {
        published += await withAdmin(adminDb, async (tx) => {
          const earlier = await totalsOf(tx, { creatorId, from: before, to: payPeriodLastDay(before) });
          const latest = await totalsOf(tx, { creatorId, from, to });
          let inserted = 0;
          for (const change of agencyShareChanges(earlier.rows, latest.rows)) {
            const rows = await tx
              .insert(schema.domainEvents)
              .values({
                id: newId(EventIdSchema),
                creatorId,
                type: 'agency_share_changed',
                payload: EVENT_PAYLOADS.agency_share_changed.parse({ creatorId, from, to, ...change }),
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
      if (notify !== null) await tellOwners(adminDb, notify, from, now);
      return published;
    },
  };
}

/** Every alert on the agency's share of the fortnight `from`, to every owner's account, in the agency's zone. */
async function tellOwners(adminDb: Database, notify: Notify, from: PayPeriod, now: Date): Promise<void> {
  const { owners, alerts, timeZone } = await withAdmin(adminDb, async (tx) => {
    const ownerRows = await tx.execute(sql`select id from "user" where role = 'owner' order by id`);
    const alertRows = await tx.execute(sql`
      select e.id, e.type, e.payload, c.display_name
        from domain_events e
        join creators c on c.id = e.creator_id
       where e.type in ('agency_share_mismatch', 'agency_share_changed')
         -- Published after the fortnight ends: bounded by time, as the outbox is never purged.
         and e.created_at >= ${from}::date
         and e.payload->>'from' = ${from}
       order by e.created_at, e.id`);
    return {
      owners: ownerRows.rows.map((row) => OwnerRowSchema.parse(row).id),
      alerts: alertRows.rows.map((row) => {
        const parsed = AlertRowSchema.parse(row);
        return { id: parsed.id, alert: alertOf(parsed), name: parsed.display_name };
      }),
      timeZone: await agencyTimeZone(tx),
    };
  });
  for (const { id, alert, name } of alerts) {
    for (const userId of owners) {
      await notify(
        {
          userId,
          reason: 'agency_share',
          objectKey: id,
          timeZone,
          message: agencyShareAlertMessage(alert, name),
        },
        now,
      );
    }
  }
}
