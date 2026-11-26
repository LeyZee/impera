import type { NewCreatorDecision, PushMessage } from '@impera/contracts';

/** Her « Aujourd'hui », where the card waits on top. */
const TODAY_SCREEN = '/aujourdhui';

/**
 * What her phone says of a new question (ADR 0164 § 9), pure: the question itself, written by the code that asked,
 * never an answer nor a text the model wrote. One tag, so a second question replaces the first on her screen.
 */
export function decisionMessage(decision: Pick<NewCreatorDecision, 'question'>): PushMessage {
  return { title: 'Une question pour toi', body: decision.question, url: TODAY_SCREEN, tag: 'decision' };
}

/** How the notification of a question is named: once per account and question, even replayed. */
export function decisionNoticeKey(decision: Pick<NewCreatorDecision, 'kind' | 'subject'>): string {
  return `decision:${decision.kind}:${decision.subject}`;
}
