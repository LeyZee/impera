import type { CreatorMessageWriter, MessageAuthor, MessageDirection } from '@impera/contracts';

/** What the base knows of who wrote a message, as the creator's read holds it before anything is shown to her. */
export interface StoredWriter {
  readonly direction: MessageDirection;
  readonly author: MessageAuthor;
  /** The agent's draft the message was sent from, by Impera's send; `null` for one read on the platform. */
  readonly draftId: string | null;
}

/**
 * Who wrote one of her messages, as she reads it (CRE-04, ADR 0065 § 1). A fan's message has no writer. One the AI
 * wrote is `ai` (« Automatique »): a draft sent as it was proposed, or a send of ours the connector recognised (a script
 * step). A draft a member corrected before it left is his: `editors` gives, by draft, the display name of the member
 * who corrected it, and a draft corrected by someone who is not a member (the owner) is the agency's. Anything else of
 * hers was written on the platform, outside Impera (`platform`, « Écrit sur Reveal »).
 */
export function writtenBy(
  message: StoredWriter,
  editors: ReadonlyMap<string, string>,
): CreatorMessageWriter | null {
  if (message.direction === 'inbound') return null;
  if (message.author === 'ai') return { kind: 'ai' };
  if (message.draftId === null) return { kind: 'platform' };
  const displayName = editors.get(message.draftId);
  return displayName === undefined || displayName === ''
    ? { kind: 'agency' }
    : { kind: 'chatter', displayName };
}

/** The drafts whose corrector the read must name: hers, sent by Impera after a human corrected them. */
export function correctedDrafts(messages: readonly StoredWriter[]): string[] {
  const ids = messages.flatMap((message) =>
    message.direction === 'outbound' && message.author === 'human' && message.draftId !== null
      ? [message.draftId]
      : [],
  );
  return [...new Set(ids)];
}
