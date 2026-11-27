import type { Logger } from './logger';

/** Tells an outside watcher that this worker is alive; never throws (OPS-22). */
export type HeartbeatPing = () => Promise<void>;

export interface HeartbeatPingOptions {
  /** Tests give their own; production uses Node's `fetch`. */
  readonly fetch?: (url: string, init: { readonly signal: AbortSignal }) => Promise<{ readonly ok: boolean }>;
  readonly now?: () => number;
  /** At most one ping this often, whatever the heartbeat's rhythm. */
  readonly minIntervalMs?: number;
  readonly timeoutMs?: number;
}

const MIN_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 10_000;

/**
 * The worker's pulse for a watcher outside the machine (`WORKER_HEARTBEAT_URL`, deploy.md § 1.6): a `GET` sent after a
 * heartbeat written in the database, so that silence means the worker, its event loop or the database is gone, the
 * three cases where no alert of the application can ring any more. The watcher writes to the owner when the pings stop.
 * The address is a secret of its own (whoever has it can ping in the worker's place): it is never logged, nor the
 * error that might quote it; a failed ping is a warning, the next one tries again.
 */
export function createHeartbeatPing(
  url: string,
  logger: Pick<Logger, 'warn'>,
  options: HeartbeatPingOptions = {},
): HeartbeatPing {
  const send = options.fetch ?? ((target, init) => fetch(target, init));
  const now = options.now ?? (() => Date.now());
  const minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  let lastPingAt: number | null = null;
  return async () => {
    const at = now();
    if (lastPingAt !== null && at - lastPingAt < minIntervalMs) return;
    lastPingAt = at;
    try {
      const response = await send(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) logger.warn('heartbeat ping refused by the watcher');
    } catch (error) {
      logger.warn({ errName: error instanceof Error ? error.name : 'unknown' }, 'heartbeat ping failed');
    }
  };
}
