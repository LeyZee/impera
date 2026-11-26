import type {
  CreatorId,
  NewCreatorDecision,
  NotificationOutcome,
  NotificationRequest,
} from '@impera/contracts';

import { decisionMessage, decisionNoticeKey } from '../domain/notice';
import type { DecisionAsking } from '../domain/ports';

export interface AskDeps {
  readonly asking: Pick<DecisionAsking, 'ask' | 'read' | 'phones'>;
  /** The `notifications` module's `notify`; `null` when push is off: the question waits on her card all the same. */
  readonly notify: ((request: NotificationRequest, at: Date) => Promise<NotificationOutcome>) | null;
}

/**
 * Asks her (ADR 0164 § 9) and tells each of her accounts once, under her quiet hours and her daily cap. Replayable: a
 * question already asked is not written again, and while it is still open its notification is asked again under the
 * same key, which rings nothing twice; a question answered, withdrawn or ended rings nothing.
 */
export async function askAndTell(
  deps: AskDeps,
  creatorId: CreatorId,
  decision: NewCreatorDecision,
  now: Date,
): Promise<boolean> {
  const written = await deps.asking.ask(creatorId, decision);
  if (deps.notify === null) return written;
  const asked = await deps.asking.read(creatorId, decision.kind, decision.subject, now);
  if (asked?.state !== 'open') return written;
  const { accounts, timeZone } = await deps.asking.phones(creatorId);
  const message = decisionMessage(decision);
  for (const userId of accounts)
    await deps.notify(
      { userId, reason: 'decision', objectKey: decisionNoticeKey(decision), timeZone, message },
      now,
    );
  return written;
}
