import {
  EVENT_PAYLOADS,
  EventIdSchema,
  newId,
  type ConnectionService,
  type ConnectionSignal,
  type EventPayload,
} from '@nirvana/contracts';
import { schema, sql, withAdmin, type Database } from '@nirvana/db';
import { z } from 'zod';

/** What a publisher module is handed by the composition root: a signal, kept only when it is a transition. */
export type PublishConnectionState = (
  service: ConnectionService,
  signal: ConnectionSignal,
  correlationId: string,
) => Promise<boolean>;

const LatestSchema = z.object({ state: z.enum(['down', 'back']) });

/**
 * `connection_state_changed` in the outbox (Telegram P3-12), with no creator and the owner role (RLS). The modules say
 * what they see at each check; only a transition is written: `down` when the latest row of the service is not a `down`
 * already, `back` when it is one. The API and the worker may see the same outage at the same time: an advisory lock
 * per service makes the second one find the first one's row. `true` when a row was written.
 */
export function createConnectionStatePublisher(
  adminDb: Database,
  now: () => Date = () => new Date(),
): PublishConnectionState {
  return (service, signal, correlationId) =>
    withAdmin(adminDb, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`connection_state:${service}`}))`);
      const latest = await tx.execute(sql`
        select payload->>'state' as state from domain_events
        where type = 'connection_state_changed' and payload->>'service' = ${service}
        order by created_at desc, id desc
        limit 1`);
      const [row] = latest.rows;
      const wasDown = row !== undefined && LatestSchema.parse(row).state === 'down';
      if (signal.state === 'down' ? wasDown : !wasDown) return false;
      const at = now();
      const payload: EventPayload<'connection_state_changed'> = EVENT_PAYLOADS.connection_state_changed.parse(
        signal.state === 'down'
          ? { service, state: 'down', reason: signal.reason, since: at.toISOString() }
          : { service, state: 'back', since: at.toISOString() },
      );
      await tx.insert(schema.domainEvents).values({
        id: newId(EventIdSchema),
        creatorId: null,
        type: 'connection_state_changed',
        payload,
        actor: 'system',
        correlationId,
        createdAt: at,
      });
      return true;
    });
}
