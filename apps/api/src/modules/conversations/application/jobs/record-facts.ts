import type { JobPayload } from '@nirvana/contracts';

import type { Clock, DraftFact, EventMeta, FanDirectory, JobLogger, UnitOfWork } from '../../domain/ports';
import { operatorNoteFact } from '../facts';
import { appendEvent } from '../journal';

export interface RecordFactsDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly fans: Pick<FanDirectory, 'proposeFacts'>;
}

/**
 * `conversation.record_facts` (P3-02): the facts of a draft a human approved, or a chatter's note, written by the
 * `fans` module, then one `fact_confirmed` per fact written in the conversation's journal. Replayed, the module
 * finds every fact already there and writes nothing, so no event is written twice. A crash between the two steps
 * keeps the facts without their events: the journal says less, the memory is right.
 */
export function createRecordFactsJob({ uow, clock, fans }: RecordFactsDeps) {
  return async (payload: JobPayload<'conversation.record_facts'>, logger: JobLogger): Promise<void> => {
    const { source } = payload;
    const read = await uow.inTenant(payload.creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(payload.conversationId);
      if (conversation === null) return null;
      let facts: readonly DraftFact[];
      if (source.kind === 'draft') {
        const draft = await tx.drafts.lock(source.draftId);
        facts = draft?.conversationId === conversation.id ? draft.facts : [];
      } else {
        facts = [operatorNoteFact(source.note, new Date(source.at))];
      }
      return { fanId: conversation.fanId, facts };
    });
    if (read === null) {
      logger.warn({}, 'record_facts: conversation not found');
      return;
    }
    if (read.facts.length === 0) return;

    const written = await fans.proposeFacts(payload.creatorId, read.fanId, read.facts);
    if (written.length === 0) {
      logger.info({ source: source.kind }, 'record_facts: nothing new');
      return;
    }
    await uow.inTenant(payload.creatorId, async (tx) => {
      let conversation = await tx.conversations.lock(payload.conversationId);
      if (conversation === null) return;
      const meta: EventMeta = { actor: 'system', correlationId: payload.correlationId, at: clock.now() };
      for (const fact of written) {
        conversation = await appendEvent(
          tx,
          conversation,
          {
            type: 'fact_confirmed',
            payload: { fanId: read.fanId, factId: fact.id, category: fact.category },
          },
          meta,
        );
      }
    });
    logger.info({ source: source.kind, facts: written.length }, 'record_facts: facts written');
  };
}
