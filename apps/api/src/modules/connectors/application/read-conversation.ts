import type { CreatorId, JobPayload, Platform } from '@impera/contracts';

import { ConnectorError } from '../domain/platform-connector';
import type { AccountJobs, AccountStore, Clock, JobLogger } from '../domain/ports';

import { ingestConversation } from './ingest-conversation';
import { CATCH_UP_AFTER_HOURS, loadActiveAccount, type AccountJobDeps } from './poll';

/** Last messages read from a conversation the polls never read: what the copilot needs, never her whole history. */
const READ_MESSAGES = 20;
/** One read of the same conversation per account at most this often, whatever the panel asks (it asks every 5 s). */
export const READ_AGAIN_AFTER_MS = 60_000;

/**
 * `connector.read_conversation` (recette du 16/11), on the account's queue: one conversation read by its id and
 * ingested like a poll would (idempotent). The copilot panel asked for it because no poll had read it: calm since
 * before the account's first poll, it is in no list. A conversation another account holds answers `not_found`: the
 * job says so and stops. Its other failures are logged, not fed to the breaker: a read the panel asked for is not
 * the account's rhythm, and the next poll tells the breaker what the platform does.
 */
export function createReadConversationJob(deps: AccountJobDeps) {
  return async (payload: JobPayload<'connector.read_conversation'>, logger: JobLogger): Promise<void> => {
    const now = deps.clock.now();
    const account = await loadActiveAccount(deps, payload, now);
    if (typeof account === 'string') {
      logger.info(
        { platformAccountId: payload.platformAccountId, reason: account },
        'read conversation: skipped',
      );
      return;
    }
    const connector = await deps.resolver.forAccount(account);
    if (connector === null) return;
    try {
      const snapshot = await connector.getConversation({
        platform: account.platform,
        id: payload.platformConversationId,
      });
      const created = await ingestConversation(connector, deps.ingest, account, snapshot, {
        limit: READ_MESSAGES,
        correlationId: payload.correlationId,
        // Read because a person opened it: his old messages are caught up, a fresh one is answered like a polled one.
        catchUp: new Date(now.getTime() - CATCH_UP_AFTER_HOURS * 3_600_000),
      });
      logger.info({ platformAccountId: account.id, created }, 'read conversation: done');
    } catch (error) {
      if (error instanceof ConnectorError && error.code === 'not_found') {
        logger.info({ platformAccountId: account.id }, 'read conversation: not this account’s');
        return;
      }
      logger.warn(
        { platformAccountId: account.id, code: error instanceof ConnectorError ? error.code : 'unknown' },
        'read conversation: failed',
      );
    }
  };
}

/** What the copilot panel names: a conversation of a platform, and the creators the person may read. */
export interface ConversationReadAsk {
  readonly creatorIds: readonly CreatorId[];
  readonly platform: Platform;
  readonly platformConversationId: string;
  readonly correlationId: string;
}

/**
 * The copilot's « Impera n'a pas encore lu cette conversation » (recette du 16/11): one `connector.read_conversation`
 * queued for each account of these creators on this platform that may be read now. The panel asks every few seconds
 * while the answer stays unknown: a conversation already asked within `READ_AGAIN_AFTER_MS` is not asked again (kept
 * in memory: a restart only costs one read more). How many reads were queued.
 */
export function createAskConversationRead(deps: {
  readonly accounts: Pick<AccountStore, 'listPollable'>;
  readonly jobs: Pick<AccountJobs, 'enqueueConversationRead'>;
  readonly platforms: readonly Platform[];
  readonly clock: Clock;
}) {
  const askedAt = new Map<string, number>();
  return async (ask: ConversationReadAsk): Promise<number> => {
    if (!deps.platforms.includes(ask.platform)) return 0;
    const now = deps.clock.now().getTime();
    for (const [key, at] of askedAt) if (now - at >= READ_AGAIN_AFTER_MS) askedAt.delete(key);
    const theirs = (await deps.accounts.listPollable([ask.platform])).filter((account) =>
      ask.creatorIds.includes(account.creatorId),
    );
    let queued = 0;
    for (const account of theirs) {
      const key = `${account.id}|${ask.platformConversationId}`;
      if (askedAt.has(key)) continue;
      askedAt.set(key, now);
      await deps.jobs.enqueueConversationRead(account, ask.platformConversationId, ask.correlationId);
      queued += 1;
    }
    return queued;
  };
}
