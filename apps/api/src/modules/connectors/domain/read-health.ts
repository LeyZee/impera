import type { ConnectionDownReason, ConnectionService, ConnectionSignal, Platform } from '@impera/contracts';

import type { ConnectorError } from './platform-connector';
import type { BreakerState } from './rhythm';

/**
 * Whether the AI still reads a platform (décision de Charles du 27/11/2026, audit de robustesse): the agent answers all
 * night, so a read that stops leaves it mute until someone looks. The read is told down to the owners when it can no
 * longer go on by itself, never at one slow minute:
 * - the breaker opens (`breakerThreshold` failed reads in a row, about 5 minutes at the default rhythm), with the
 *   cause: the platform changed the shape of its answers, or it no longer answers;
 * - the AI's session dies (`expired`): nothing is read until an owner reconnects the bot.
 * It is told back at the first read that succeeds after a pause or a gap. The outbox keeps the transitions only
 * (`connection_state_changed`), so a read down for hours rings once.
 */

/** The service the read of a platform is told under: Reveal's only, the other platforms have no connector yet. */
export function readServiceOf(platform: Platform): ConnectionService | null {
  return platform === 'reveal' ? 'reveal_read' : null;
}

/** The cause in plain words: a session refused, an answer of a shape the connector does not know, or no answer. */
export function readDownReason(error: ConnectorError): ConnectionDownReason {
  if (error.code === 'session_expired') return 'session_expired';
  // The connector names a shape it no longer knows `shape_changed` (`fatal`), never with a value of the answer.
  if (error.code === 'fatal' && error.message.startsWith('shape_changed')) return 'format_changed';
  return 'unreachable';
}

/** A read this long after the last one comes after a stop (a session dead, the breaker, the PC asleep). */
const READ_BACK_AFTER_GAP_MS = 5 * 60_000;

/**
 * Does this successful read end a stop? After the breaker (`pausedUntil` still set until the read succeeds), the
 * first read ever, or a gap longer than `READ_BACK_AFTER_GAP_MS` (an account polled again after a « Sync »). A read in
 * the regular rhythm tells nothing: the outbox is not asked each minute.
 */
export function readCameBack(
  account: BreakerState & { readonly lastPollAt: Date | null },
  now: Date,
): boolean {
  if (account.lastPollAt === null || account.pausedUntil !== null) return true;
  return now.getTime() - account.lastPollAt.getTime() > READ_BACK_AFTER_GAP_MS;
}

/** What the module is handed to tell the read's state: the outbox keeps only the transitions. */
export type ReadHealth = (
  platform: Platform,
  signal: ConnectionSignal,
  correlationId: string,
) => Promise<void>;
