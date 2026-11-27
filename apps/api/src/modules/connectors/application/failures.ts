import { ConnectorError } from '../domain/platform-connector';
import type { AccountStore, ConnectorAccount, EventMeta, JobLogger } from '../domain/ports';
import { readDownReason, type ReadHealth } from '../domain/read-health';
import { afterFailure } from '../domain/rhythm';

/**
 * What a failed poll leaves behind (connectors.md § coupe-circuit). An expired session stops the account until the
 * next « Sync » (state `expired`, event). Any other connector error counts toward the breaker; at the threshold
 * the account pauses and an `error` event tells the supervision. A job that reads the fans' messages (`poll`) hands
 * `readHealth`: the breaker opening tells the owners the read is down, with its cause (décision du 27/11/2026); a
 * failure to tell it is only logged. Anything that is not a `ConnectorError` is a bug or the database: it is rethrown
 * so Graphile keeps it.
 */
export async function recordConnectorFailure(
  accounts: AccountStore,
  account: ConnectorAccount,
  error: unknown,
  context: {
    readonly meta: EventMeta;
    readonly logger: JobLogger;
    readonly jobName: string;
    readonly readHealth?: ReadHealth;
  },
): Promise<void> {
  if (!(error instanceof ConnectorError)) throw error;
  const { meta, logger, jobName, readHealth } = context;
  const where = { platformAccountId: account.id, code: error.code };
  if (error.code === 'session_expired') {
    await accounts.setSessionState(account.creatorId, account.id, 'expired', meta);
    logger.warn(where, `${jobName}: session expired, account stopped`);
    return;
  }
  const next = afterFailure(account, account.config, meta.at);
  await accounts.recordFailure(account.creatorId, account.id, next);
  if (next.opened) {
    await accounts.publish(
      account.creatorId,
      { type: 'error', payload: { code: `connector_${error.code}`, jobName, retryable: true } },
      meta,
    );
    if (readHealth !== undefined) {
      await readHealth(
        account.platform,
        { state: 'down', reason: readDownReason(error) },
        meta.correlationId,
      ).catch((err: unknown) => {
        logger.warn({ ...where, err }, `${jobName}: read outage not told`);
      });
    }
  }
  logger.warn(
    { ...where, consecutiveErrors: next.consecutiveErrors, breakerOpened: next.opened },
    `${jobName}: failed`,
  );
}
