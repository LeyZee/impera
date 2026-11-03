import type { ConversationSnapshot, ExternalMessage } from '@impera/contracts';

import { ConnectorError, type PlatformConnector } from '../domain/platform-connector';
import type { ConnectorAccount, IngestMessage } from '../domain/ports';

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
  opts: { readonly since?: Date; readonly limit?: number; readonly correlationId: string },
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
      fanDisplayName: snapshot.fanDisplayName,
      message,
      correlationId: opts.correlationId,
    });
    if (result.isNew) created += 1;
  }
  return created;
}
