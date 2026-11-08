import type { JobPayload } from '@impera/contracts';

import type { CardReader, Clock, FanDirectory, JobLogger, UnitOfWork } from '../../domain/ports';

/** Messages the read gets, his new ones and what came before them: enough to tell who says what. */
const CARD_READ_WINDOW = 40;

export interface ReadCardDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly fans: Pick<FanDirectory, 'cardLines' | 'proposeRead'>;
  readonly reader: CardReader;
}

/**
 * `fans.read_card` (ADR 0085 § 7): his messages not read yet, with the card as it is, go to the AI, and what it reads
 * is written by the `fans` module, which checks each value and lets a chatter's note stand (§ 6, § 8). Whoever answers
 * him, every message of his is read. Not read (budget at its alert, no model), nothing is marked: the next message
 * of his reads them with it. Replayed after a write, the same values are found already there and nothing is written
 * twice. Only field codes are logged, never a value (§ 10).
 */
export function createReadCardJob({ uow, clock, fans, reader }: ReadCardDeps) {
  return async (payload: JobPayload<'fans.read_card'>, logger: JobLogger): Promise<void> => {
    const { creatorId, conversationId } = payload;
    const toRead = await uow.inTenant(creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(conversationId);
      if (conversation === null) return null;
      return { fanId: conversation.fanId, ...(await tx.cardReads.toRead(conversationId, CARD_READ_WINDOW)) };
    });
    if (toRead === null) {
      logger.warn({}, 'read_card: conversation not found');
      return;
    }
    const { fanId, through } = toRead;
    if (through === null) {
      logger.info({}, 'read_card: nothing new');
      return;
    }
    const messages = toRead.messages.map((message, index) => ({ ...message, number: index + 1 }));
    const result = await reader.read({
      creatorId,
      conversationId,
      card: await fans.cardLines(creatorId, fanId),
      messages: messages.map(({ number, from, text, isNew }) => ({ number, from, text, isNew })),
    });
    if (!result.ok) {
      logger.warn({ reason: result.reason }, 'read_card: not read, his messages wait for the next read');
      return;
    }
    const sources = messages
      .filter((message) => message.isNew)
      .map((message) => ({ number: message.number, messageId: message.id, at: message.at }));
    const written = await fans.proposeRead(creatorId, fanId, result.read, sources);
    await uow.inTenant(creatorId, (tx) => tx.cardReads.markRead(conversationId, through, clock.now()));
    logger.info(
      {
        proposed: result.read.facts.map((fact) => fact.field),
        written: written.map((fact) => fact.key),
      },
      'read_card: card read',
    );
  };
}
