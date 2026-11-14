import type { JobPayload, SessionState } from '@impera/contracts';

import { ConnectorError } from '../domain/platform-connector';
import type { AccountStore, Clock, ConnectorAccount, IngestMessage, JobLogger } from '../domain/ports';
import { isPaused, POLL_OVERLAP_SECONDS } from '../domain/rhythm';

import { recordConnectorFailure } from './failures';
import { ingestConversation } from './ingest-conversation';
import type { ConnectorResolver } from './resolver';

/** On the very first poll, how far back to read: recent fans get an answer, an old history is not replayed. */
const FIRST_POLL_LOOKBACK_HOURS = 24;

/**
 * A fan's message older than this when it is read is caught up, not answered (P2-02): after the PC slept, a whole
 * night of messages never sets off one model call per fan at once. A fresh message of his still starts the answer.
 */
export const CATCH_UP_AFTER_HOURS = 6;

const POLLABLE: readonly SessionState[] = ['valid', 'warning'];

export interface AccountJobDeps {
  readonly accounts: AccountStore;
  readonly resolver: ConnectorResolver;
  readonly ingest: IngestMessage;
  readonly clock: Clock;
}

/** The account if a job may talk to its platform now; the reason it may not, otherwise. */
export async function loadActiveAccount(
  deps: AccountJobDeps,
  payload: JobPayload<'connector.poll'>,
  now: Date,
): Promise<ConnectorAccount | string> {
  const account = await deps.accounts.get(payload.creatorId, payload.platformAccountId);
  if (account === null) return 'unknown account';
  if (!POLLABLE.includes(account.sessionState)) return `session ${account.sessionState}`;
  if (isPaused(account, now)) return 'breaker open';
  return account;
}

/**
 * `connector.poll` (message-flow.md §1), on the account's serial queue `account:<id>`: one poll per account at a
 * time (ADR 0006). Checks the session, lists the conversations that moved since the last poll (with an overlap),
 * fetches their new messages and ingests them. Connector errors never escape: they feed the breaker.
 */
export function createPollJob(deps: AccountJobDeps) {
  return async (payload: JobPayload<'connector.poll'>, logger: JobLogger): Promise<void> => {
    const now = deps.clock.now();
    const account = await loadActiveAccount(deps, payload, now);
    if (typeof account === 'string') {
      logger.info({ platformAccountId: payload.platformAccountId, reason: account }, 'poll: skipped');
      return;
    }
    const connector = await deps.resolver.forAccount(account);
    if (connector === null) {
      logger.info({ platformAccountId: account.id, reason: 'no connector' }, 'poll: skipped');
      return;
    }
    const meta = { correlationId: payload.correlationId, at: now };
    try {
      const health = await connector.health();
      if (health === 'expired' || health === 'none') {
        throw new ConnectorError('session_expired', 'Session refusée par la plateforme');
      }
      if (health !== account.sessionState) {
        await deps.accounts.setSessionState(account.creatorId, account.id, health, meta);
      }
      const since =
        account.lastPollAt === null
          ? new Date(now.getTime() - FIRST_POLL_LOOKBACK_HOURS * 3_600_000)
          : new Date(account.lastPollAt.getTime() - POLL_OVERLAP_SECONDS * 1_000);
      const snapshots = await connector.listConversations({ since });
      let created = 0;
      for (const snapshot of snapshots) {
        created += await ingestConversation(connector, deps.ingest, account, snapshot, {
          since,
          correlationId: payload.correlationId,
          // The same rule at the first poll as after it (P2-02): the last day is read once, a message older than six
          // hours is stored and not answered, a fresh one, written just before the first « Sync », is.
          catchUp: new Date(now.getTime() - CATCH_UP_AFTER_HOURS * 3_600_000),
        });
      }
      await deps.accounts.recordPoll(account.creatorId, account.id, now);
      logger.info({ platformAccountId: account.id, conversations: snapshots.length, created }, 'poll: done');
    } catch (error) {
      await recordConnectorFailure(deps.accounts, account, error, { meta, logger, jobName: 'poll' });
    }
  };
}
