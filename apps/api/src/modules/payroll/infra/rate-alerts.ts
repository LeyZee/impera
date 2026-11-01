import { EventIdSchema, EVENT_PAYLOADS, newId } from '@nirvana/contracts';
import { schema, sql, withAdmin, type Database } from '@nirvana/db';

import type { PayrollRateAlerts } from '../domain/ports';

/**
 * `exchange_rate_overdue` in the outbox (ADR 0033), as `backup_overdue`: it belongs to no creator, so the row has
 * `creator_id` null and is written with the admin role (RLS). Two workers can run the job at once: the first writes
 * the day's row for the currency, the other finds it (advisory lock). The payload is parsed by its contract before it
 * is written (docs/architecture/jsonb.md). The search looks back two days only: the day's row is younger than that, and
 * `domain_events_created_idx` then serves it instead of a scan of every conversation's events, each hour.
 */
export function createPostgresRateAlerts(adminDb: Database): PayrollRateAlerts {
  return {
    publishOverdue(alert) {
      const payload = EVENT_PAYLOADS.exchange_rate_overdue.parse(alert);
      const key = `exchange_rate_overdue:${payload.currency}:${payload.day}`;
      return withAdmin(adminDb, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
        const seen = await tx.execute(sql`
          select 1 from domain_events where created_at >= now() - interval '2 days' and type = 'exchange_rate_overdue'
            and payload->>'currency' = ${payload.currency} and payload->>'day' = ${payload.day} limit 1`);
        if (seen.rows.length > 0) return false;
        await tx.insert(schema.domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: null,
          type: 'exchange_rate_overdue',
          payload,
          actor: 'system',
          correlationId: `exchange_rate:${payload.currency}:${payload.day}`,
          createdAt: new Date(),
        });
        return true;
      });
    },
  };
}
