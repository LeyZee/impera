import type { JobPayload } from '@impera/contracts';

import type { JobLogger } from '../domain/ports';

import { recordConnectorFailure } from './failures';
import { ingestConversation } from './ingest-conversation';
import { loadActiveAccount, type AccountJobDeps } from './poll';

/** Conversations that moved in this window are re-read. */
const RECONCILE_WINDOW_HOURS = 24;
/** Last messages re-read per conversation. */
const RECONCILE_MESSAGES = 20;

/**
 * `connector.reconcile` (message-flow.md §7), every 10 minutes on the account's queue: re-reads the recent
 * conversations without a `since` cursor and ingests what the polls missed (idempotent). The safety net against
 * lost messages.
 */
export function createReconcileJob(deps: AccountJobDeps) {
  return async (payload: JobPayload<'connector.reconcile'>, logger: JobLogger): Promise<void> => {
    const now = deps.clock.now();
    const account = await loadActiveAccount(deps, payload, now);
    if (typeof account === 'string') {
      logger.info({ platformAccountId: payload.platformAccountId, reason: account }, 'reconcile: skipped');
      return;
    }
    const connector = await deps.resolver.forAccount(account);
    if (connector === null) return;
    const meta = { correlationId: payload.correlationId, at: now };
    try {
      const cutoff = now.getTime() - RECONCILE_WINDOW_HOURS * 3_600_000;
      const snapshots = (await connector.listConversations({})).filter(
        (snapshot) => snapshot.lastMessageAt !== null && new Date(snapshot.lastMessageAt).getTime() >= cutoff,
      );
      let created = 0;
      for (const snapshot of snapshots) {
        created += await ingestConversation(connector, deps.ingest, account, snapshot, {
          limit: RECONCILE_MESSAGES,
          correlationId: payload.correlationId,
        });
      }
      logger.info(
        { platformAccountId: account.id, conversations: snapshots.length, created },
        'reconcile: done',
      );
    } catch (error) {
      await recordConnectorFailure(deps.accounts, account, error, { meta, logger, jobName: 'reconcile' });
    }
  };
}
