import { FAN_CARD_READ_BATCH, jobKeyFor, type JobPayload } from '@impera/contracts';

import type { CardReader, Clock, FanDirectory, JobLogger, UnitOfWork } from '../../domain/ports';

export interface ReadCardDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly fans: Pick<FanDirectory, 'cardLines' | 'proposeRead'>;
  readonly reader: CardReader;
}

/**
 * `fans.read_card` (ADR 0085 § 7): his messages not read yet, with the card as it is, go to the AI, and what it reads
 * is written by the `fans` module, which checks each value and lets a chatter's note stand (§ 6, § 8). Whoever answers
 * him, every message of his is read: the oldest not read first, a batch of `FAN_CARD_READ_BATCH.window` at a time, and
 * while some are left the next read is chained at once under the same key (amendement du 21/11), so a long history,
 * caught up or not, is read to its end, once. Not read (budget at its alert, no model), nothing is marked and nothing
 * is chained: the next message of his reads them with it. Replayed after a write, the same values are found already
 * there and nothing is written twice. Only field codes are logged, never a value (§ 10).
 */
export function createReadCardJob({ uow, clock, fans, reader }: ReadCardDeps) {
  return async (payload: JobPayload<'fans.read_card'>, logger: JobLogger): Promise<void> => {
    const { creatorId, conversationId } = payload;
    const toRead = await uow.inTenant(creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(conversationId);
      if (conversation === null) return null;
      return {
        fanId: conversation.fanId,
        batch: await tx.cardReads.toRead(conversationId, FAN_CARD_READ_BATCH),
      };
    });
    if (toRead === null) {
      logger.warn({}, 'read_card: conversation not found');
      return;
    }
    const { fanId, batch } = toRead;
    if (batch === null) {
      logger.info({}, 'read_card: nothing new');
      return;
    }
    const { through, left } = batch;
    const messages = batch.messages.map((message, index) => ({ ...message, number: index + 1 }));
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
    await uow.inTenant(creatorId, async (tx) => {
      await tx.cardReads.markRead(conversationId, through, clock.now());
      // What is left is read next, at once: the same key replaces a read put off by his last message.
      if (left > 0)
        await tx.jobs.enqueue('fans.read_card', payload, {
          jobKey: jobKeyFor('fans.read_card', conversationId),
          runAt: clock.now(),
        });
    });
    logger.info(
      {
        proposed: result.read.facts.map((fact) => fact.field),
        written: written.map((fact) => fact.key),
        left,
      },
      'read_card: card read',
    );
  };
}
