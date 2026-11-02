import { randomUUID } from 'node:crypto';

import { NOTIFICATION_REASONS } from '@nirvana/contracts';
import { and, eq, inArray, schema, sql, withMember, type Database } from '@nirvana/db';

import { isCapped } from '../../domain/policy';
import type { DeliveryRegistry } from '../../domain/ports';

const deliveries = schema.notificationDeliveries;

const CAPPED = NOTIFICATION_REASONS.filter(isCapped);
const SALE_BURST_WINDOW = '2 minutes';

/**
 * `notification_deliveries` as the account (`withMember`, RLS: its own rows). One account's notifications are decided
 * one at a time (an advisory lock on the account), so two at once never both pass a cap of one left.
 */
export function createDeliveryRegistry(db: Database): DeliveryRegistry {
  return {
    record(request, at, localDay, decide) {
      return withMember(db, request.userId, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`notifications:${request.userId}`}, 0))`,
        );
        const id = randomUUID();
        const inserted = await tx
          .insert(deliveries)
          .values({
            id,
            userId: request.userId,
            reason: request.reason,
            objectKey: request.objectKey,
            // Decided below, in this transaction: a row is never seen undecided.
            decision: 'silent',
            localDay,
            title: request.message.title,
            url: request.message.url,
            decidedAt: at,
          })
          .onConflictDoNothing({ target: [deliveries.userId, deliveries.reason, deliveries.objectKey] })
          .returning({ id: deliveries.id });
        if (inserted.length === 0) return { action: 'duplicate' } as const;

        const [counts] = await tx
          .select({
            cappedRungToday: sql<number>`count(*) filter (
              where ${deliveries.decision} = 'rang'
                and ${deliveries.localDay} = ${localDay}
                and ${inArray(deliveries.reason, CAPPED)}
            )::int`,
            salesInBurstWindow: sql<number>`count(*) filter (
              where ${deliveries.reason} = 'sale'
                and ${deliveries.decision} in ('rang', 'grouped')
                and ${deliveries.decidedAt} > ${at}::timestamptz - ${SALE_BURST_WINDOW}::interval
                and ${deliveries.id} <> ${id}
            )::int`,
          })
          .from(deliveries)
          .where(eq(deliveries.userId, request.userId));
        const decision = decide({
          cappedRungToday: counts?.cappedRungToday ?? 0,
          salesInBurstWindow: counts?.salesInBurstWindow ?? 0,
        });
        const stored = { ring: 'rang', hold: 'held', group: 'grouped', silent: 'silent' } as const;
        await tx
          .update(deliveries)
          .set({
            decision: stored[decision.action],
            holdUntil: decision.action === 'hold' ? decision.until : null,
          })
          .where(eq(deliveries.id, id));
        if (decision.action === 'hold') {
          // One recap per account at the end of its quiet hours: a later hold in the same night keeps the same job.
          await tx.execute(
            sql`select public.enqueue_job(
              task => 'notifications.recap',
              payload => ${JSON.stringify({ userId: request.userId })}::jsonb,
              run_at => ${decision.until.toISOString()}::timestamptz,
              max_attempts => 3,
              job_key => ${`notifications.recap:${request.userId}`},
              job_key_mode => 'replace'
            )`,
          );
        }
        return decision;
      });
    },
    async takeHeld(userId, at) {
      const taken = await withMember(db, userId, (tx) =>
        tx
          .update(deliveries)
          .set({ decision: 'recapped' })
          .where(
            and(
              eq(deliveries.userId, userId),
              eq(deliveries.decision, 'held'),
              sql`${deliveries.holdUntil} <= ${at}::timestamptz`,
            ),
          )
          .returning({ id: deliveries.id }),
      );
      return taken.length;
    },
  };
}
