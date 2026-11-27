import type { JobPayload } from '@impera/contracts';

import type { Clock, JobLogger, KeywordWatch, UnitOfWork } from '../../domain/ports';
import { appendEvent } from '../journal';
import { unsounded } from '../sounded';

/** His messages read at most: those since her last answer, within the window the agent reads. */
const WATCH_WINDOW = 40;

export interface WatchKeywordsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly watch: KeywordWatch;
}

/**
 * `conversation.watch_keywords`: her alert words, read in what he wrote since her last answer while the agent does not
 * answer him (a human holds him, her agent is off, her session expired, her hours closed, or the agent did not get
 * to him). Each word not heard of yet since her last answer, by this job or by the agent's turn, becomes an
 * `alert_triggered`: the team and she are told by the router. Nothing is paused, nothing is sent, nothing is written
 * to him; a human decides. Named, never his words (ADR 0020).
 */
export function createWatchKeywordsJob({ uow, clock, watch }: WatchKeywordsDeps) {
  return async (payload: JobPayload<'conversation.watch_keywords'>, logger: JobLogger): Promise<void> => {
    const { creatorId, conversationId } = payload;
    const read = await uow.inTenant(creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(conversationId);
      if (conversation === null) return null;
      // An archived creator's agent no longer works and the router tells nobody of her (ADR 0071).
      if ((await tx.gate.blockedReason(conversation)) === 'creator_archived') return null;
      const history = await tx.messages.history(conversation.id, WATCH_WINDOW);
      const lastAnswer = history.findLastIndex((message) => message.author !== 'fan');
      return history
        .slice(lastAnswer + 1)
        .map((message) => message.text)
        .join('\n');
    });
    if (read === null || read.trim() === '') return;
    const alerts = await watch.alertsIn(creatorId, read, clock.now());
    if (alerts.length === 0) return;
    const fired = await uow.inTenant(creatorId, async (tx) => {
      let conversation = await tx.conversations.lock(conversationId);
      if (conversation === null) return 0;
      const sounded = await tx.events.alertsSince(conversation.id, conversation.lastOutboundAt);
      const fresh = unsounded(alerts, sounded);
      for (const alert of fresh) {
        conversation = await appendEvent(
          tx,
          conversation,
          {
            type: 'alert_triggered',
            payload: { conversationId: conversation.id, trigger: alert.trigger, notify: alert.notify },
          },
          { actor: 'system', correlationId: payload.correlationId, at: clock.now() },
        );
      }
      return fresh.length;
    });
    // Named by count only: never the word nor his text in the logs.
    if (fired > 0) logger.info({ fired }, 'watch_keywords: alert words heard while the agent did not answer');
  };
}
