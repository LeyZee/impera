import { newId } from '@impera/contracts';
import { and, eq, inArray, schema, withTenant, type Database } from '@impera/db';
import { z } from 'zod';

import type { ConnectorAccount, ConnectorSend, SendJournal } from '../../domain/ports';

const sends = schema.connectorSends;
/** A row's own id: nobody outside this table names it. */
const SendRowIdSchema = z.uuid();

function toSend(row: typeof sends.$inferSelect): ConnectorSend {
  return {
    idempotencyKey: row.idempotencyKey,
    platformConversationId: row.platformConversationId,
    fingerprint: row.fingerprint,
    scriptRef: row.scriptRef,
    startedAt: row.attemptStartedAt,
    platformMessageId: row.platformMessageId,
    sentAt: row.sentAt,
  };
}

/**
 * `connector_sends` of one account (reveal-connector-spec.md § 5), each call in its own tenant transaction: the row
 * must be committed before the platform is called, so that a process killed after Reveal took the message still
 * leaves the attempt behind for the next try to check.
 */
export function createSendJournal(db: Database, account: ConnectorAccount): SendJournal {
  const ofKey = (key: string) => and(eq(sends.platformAccountId, account.id), eq(sends.idempotencyKey, key));
  const inTenant = <T>(work: Parameters<typeof withTenant<T>>[2]) => withTenant(db, account.creatorId, work);

  return {
    find: (key) =>
      inTenant(async (tx) => {
        const [row] = await tx.select().from(sends).where(ofKey(key));
        return row === undefined ? null : toSend(row);
      }),

    begin: (send) =>
      inTenant(async (tx) => {
        await tx
          .insert(sends)
          .values({
            id: newId(SendRowIdSchema),
            creatorId: account.creatorId,
            platformAccountId: account.id,
            idempotencyKey: send.idempotencyKey,
            platformConversationId: send.platformConversationId,
            fingerprint: send.fingerprint,
            scriptRef: send.scriptRef,
            attemptStartedAt: send.startedAt,
          })
          .onConflictDoNothing();
        const [row] = await tx.select().from(sends).where(ofKey(send.idempotencyKey));
        if (row === undefined) throw new Error('connector_sends: the attempt was not recorded');
        return toSend(row);
      }),

    settle: (key, platformMessageId, sentAt) =>
      inTenant(async (tx) => {
        // Once: a row that already has its id keeps it.
        await tx
          .update(sends)
          .set({ state: 'sent', platformMessageId, sentAt })
          .where(and(ofKey(key), eq(sends.state, 'pending')));
      }),

    ownIds: async (conversationId, ids) => {
      if (ids.length === 0) return new Set();
      const rows = await inTenant((tx) =>
        tx
          .select({ id: sends.platformMessageId })
          .from(sends)
          .where(
            and(
              eq(sends.platformAccountId, account.id),
              eq(sends.platformConversationId, conversationId),
              inArray(sends.platformMessageId, [...ids]),
            ),
          ),
      );
      return new Set(rows.flatMap((row) => (row.id === null ? [] : [row.id])));
    },
  };
}
