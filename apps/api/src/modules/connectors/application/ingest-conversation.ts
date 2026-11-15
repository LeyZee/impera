import type { ConversationSnapshot, ExternalMessage } from '@impera/contracts';

import { ConnectorError, type PlatformConnector } from '../domain/platform-connector';
import type { ConnectorAccount, IngestMessage } from '../domain/ports';

// eslint-disable-next-line no-control-regex -- the control character is the point
const NUL = /\u0000/gu;

/**
 * U+0000 has no meaning in a message or a name and Postgres refuses it in text: one in a fan's message made the
 * insert fail, then the worker, and the account's queue stayed locked (recette 05/11, MOT-01). A fan's text is data;
 * it is cleaned here, where platform data enters the core.
 */
function withoutNul(text: string): string {
  return text.replace(NUL, '');
}

function messageWithoutNul(message: ExternalMessage): ExternalMessage {
  return {
    ...message,
    text: withoutNul(message.text),
    ...(message.senderLabel === undefined ? {} : { senderLabel: withoutNul(message.senderLabel) }),
  };
}

/**
 * Reads one conversation's messages and hands them to `conversations`, oldest first. Ingestion is idempotent
 * (`platform_message_id`), so re-reading an overlap costs nothing. A conversation the platform no longer finds is
 * skipped. Returns how many messages were new.
 */
export async function ingestConversation(
  connector: PlatformConnector,
  ingest: IngestMessage,
  account: ConnectorAccount,
  snapshot: ConversationSnapshot,
  opts: {
    readonly since?: Date;
    readonly limit?: number;
    readonly correlationId: string;
    /** `true` for every message (the account's first poll); otherwise each one older than this instant is caught up. */
    readonly catchUp: boolean | Date;
  },
): Promise<number> {
  let messages: ExternalMessage[];
  try {
    messages = await connector.fetchMessages(snapshot.ref, {
      ...(opts.since === undefined ? {} : { since: opts.since }),
      ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    });
  } catch (error) {
    if (error instanceof ConnectorError && error.code === 'not_found') return 0;
    throw error;
  }
  let created = 0;
  for (const message of [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const result = await ingest({
      creatorId: account.creatorId,
      platformAccountId: account.id,
      platformConversationId: snapshot.ref.id,
      platformFanId: snapshot.fanRef.id,
      fanDisplayName: withoutNul(snapshot.fanDisplayName),
      message: messageWithoutNul(message),
      catchUp:
        opts.catchUp === true ||
        (opts.catchUp instanceof Date && new Date(message.createdAt).getTime() < opts.catchUp.getTime()),
      correlationId: opts.correlationId,
    });
    if (result.isNew) created += 1;
  }
  return created;
}
