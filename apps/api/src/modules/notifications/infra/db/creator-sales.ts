import { CreatorIdSchema, EVENT_PAYLOADS } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';
import { z } from 'zod';

import type { CreatorSaleSource } from '../../domain/ports';

/** Of the event, only what her phone says and its key: `seller` never leaves the row. */
const SalePartSchema = EVENT_PAYLOADS.sale_detected.pick({
  saleId: true,
  creatorMinor: true,
  currency: true,
});

const EventRowSchema = z.object({
  creatorId: CreatorIdSchema,
  payload: z.unknown(),
  timeZone: z.string().min(1),
});

/**
 * The sale of a `sale_detected` and her accounts, by the job's role (`withAdmin`, as the other jobs): the outbox is
 * hidden from her own account and out of reach of a job's tenant-less path. Her accounts are the ones whose role is
 * `creator` and whose only creator is hers (one link per account since CR-02).
 */
export function createCreatorSaleSource(adminDb: Database): CreatorSaleSource {
  const events = schema.domainEvents;
  return {
    saleOf: (eventId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({
            creatorId: events.creatorId,
            payload: events.payload,
            timeZone: schema.creators.timezone,
          })
          .from(events)
          .innerJoin(schema.creators, eq(schema.creators.id, events.creatorId))
          .where(and(eq(events.id, eventId), eq(events.type, 'sale_detected')));
        if (row === undefined) return null;
        const event = EventRowSchema.parse(row);
        const sale = SalePartSchema.parse(event.payload);
        const accounts = await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.role, 'creator'),
              sql`${schema.user.creatorIds} = array[${event.creatorId}]::uuid[]`,
            ),
          )
          .orderBy(schema.user.id);
        return {
          saleId: sale.saleId,
          creatorMinor: sale.creatorMinor,
          currency: sale.currency,
          timeZone: event.timeZone,
          accounts: accounts.map((account) => account.id),
        };
      }),
  };
}
