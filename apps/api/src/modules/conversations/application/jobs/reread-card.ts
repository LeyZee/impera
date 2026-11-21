import { FAN_CARD_READ_BATCH, FAN_CARD_REREAD, jobKeyFor, type JobPayload } from '@impera/contracts';

import type {
  CardReader,
  CardRereadRoom,
  CardRereadScan,
  Clock,
  FanDirectory,
  JobLogger,
  UnitOfWork,
} from '../../domain/ports';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * `fans.reread_cards` (ADR 0085 § 7, amendement du 21/11), each week: one re-read per conversation where he wrote in the
 * last `FAN_CARD_REREAD.activeDays`, spaced so they never come at once. The scan leaves out creators whose card is off.
 */
export function createRereadCardsJob({
  uow,
  clock,
  scan,
}: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly scan: CardRereadScan;
}) {
  return async (_payload: JobPayload<'fans.reread_cards'>, logger: JobLogger): Promise<void> => {
    const now = clock.now();
    const active = await scan.active(new Date(now.getTime() - FAN_CARD_REREAD.activeDays * DAY_MS));
    for (const [index, { creatorId, conversationId }] of active.entries())
      await uow.inTenant(creatorId, (tx) =>
        tx.jobs.enqueue(
          'fans.reread_card',
          {
            creatorId,
            conversationId,
            correlationId: `reread:${now.toISOString()}`,
            after: null,
            startedAt: now.toISOString(),
          },
          {
            jobKey: jobKeyFor('fans.reread_card', conversationId),
            runAt: new Date(now.getTime() + index * FAN_CARD_REREAD.spacingSeconds * 1_000),
          },
        ),
      );
    logger.info({ conversations: active.length }, 'reread_cards: the week’s re-read enqueued');
  };
}

/**
 * `fans.reread_card` (amendement du 21/11): a batch of one conversation read again from its start, every message of his
 * new for this pass, written by the `fans` module like any read (a chatter's note stands, a value already there is not
 * written twice). It spends only while the day leaves room (`FAN_CARD_REREAD.maxShareOfCap`): otherwise, or when the
 * gateway stops it at the alert, the same batch tries again later, until the pass is `giveUpDays` old. The live
 * reading's place (`card_read_through`) is never moved.
 */
export function createRereadCardJob({
  uow,
  clock,
  fans,
  reader,
  room,
}: {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly fans: Pick<FanDirectory, 'cardLines' | 'proposeRead'>;
  readonly reader: CardReader;
  readonly room: CardRereadRoom;
}) {
  return async (payload: JobPayload<'fans.reread_card'>, logger: JobLogger): Promise<void> => {
    const { creatorId, conversationId, after, startedAt } = payload;
    const now = clock.now();
    const later = (runAt: Date, next: JobPayload<'fans.reread_card'>) =>
      uow.inTenant(creatorId, (tx) =>
        tx.jobs.enqueue('fans.reread_card', next, {
          jobKey: jobKeyFor('fans.reread_card', conversationId),
          runAt,
        }),
      );
    if (now.getTime() - new Date(startedAt).getTime() > FAN_CARD_REREAD.giveUpDays * DAY_MS) {
      logger.info({}, 'reread_card: the week’s pass is over, the next one starts again');
      return;
    }
    const putOff = new Date(now.getTime() + FAN_CARD_REREAD.retryMinutes * MINUTE_MS);
    if (!room()) {
      await later(putOff, payload);
      logger.info({}, 'reread_card: no room in the day’s AI budget, put off');
      return;
    }
    const found = await uow.inTenant(creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(conversationId);
      if (conversation === null) return null;
      return {
        fanId: conversation.fanId,
        batch: await tx.cardReads.reread(conversationId, after, FAN_CARD_READ_BATCH),
      };
    });
    if (found === null) {
      logger.warn({}, 'reread_card: conversation not found');
      return;
    }
    const { fanId, batch } = found;
    if (batch === null) {
      logger.info({}, 'reread_card: read to its end');
      return;
    }
    const messages = batch.messages.map((message, index) => ({ ...message, number: index + 1 }));
    const result = await reader.read({
      creatorId,
      conversationId,
      card: await fans.cardLines(creatorId, fanId),
      messages: messages.map(({ number, from, text, isNew }) => ({ number, from, text, isNew })),
    });
    if (!result.ok) {
      if (result.reason === 'budget') await later(putOff, payload);
      logger.warn({ reason: result.reason }, 'reread_card: not read');
      return;
    }
    const sources = messages
      .filter((message) => message.isNew)
      .map((message) => ({ number: message.number, messageId: message.id, at: message.at }));
    const written = await fans.proposeRead(creatorId, fanId, result.read, sources);
    if (batch.next !== null) await later(now, { ...payload, after: batch.next });
    logger.info(
      {
        proposed: result.read.facts.map((fact) => fact.field),
        written: written.map((fact) => fact.key),
        done: batch.next === null,
      },
      'reread_card: batch read',
    );
  };
}
